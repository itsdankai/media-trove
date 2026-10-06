// Plex: reads played and in-progress movies and episodes from a Plex Media Server.
// Read-only: only the GET routes in READ_ONLY (plus the plex.tv sign-in) can be called.
import { randomUUID } from "node:crypto";
import { definePlugin, getJson, type Manifest, type MediaRef, UserError } from "../_sdk/index.ts";
import { diffSnapshot, type Entry, type SnapshotCursor } from "../_sdk/snapshot.ts";

export const manifest: Manifest = {
  contract: 1,
  id: "plex",
  name: "Plex",
  version: "0.1.0",
  description: "Track movies and episodes you watch on your Plex server.",
  kinds: ["movie", "show"],
  homepage: "https://www.plex.tv",
  connect: {
    fields: [
      { key: "server", label: "Server address", type: "url", required: true, placeholder: "http://192.168.1.10:32400" },
      {
        key: "email",
        label: "Plex email or username",
        type: "text",
        help: "Signs in through plex.tv once. Not stored.",
      },
      { key: "password", label: "Plex password", type: "password" },
      {
        key: "token",
        label: "Or a Plex token",
        type: "password",
        help: "Instead of signing in. Leave everything empty if the server allows your network without sign-in.",
      },
    ],
    note: "MediaTrove only reads what you've watched. It never changes anything on your server.",
  },
  sync: { intervalSeconds: 180 }, // servers on your own network: cheap to ask often
};

type Creds = { server: string; token?: string; clientId: string };

const READ_ONLY = [/^\/identity$/, /^\/library\/sections$/, /^\/library\/sections\/\d+\/all$/];

export function assertReadOnly(method: string, path: string) {
  if (method !== "GET" || !READ_ONLY.some((re) => re.test(path))) {
    throw new Error(`Plex plugin is read-only: refused ${method} ${path}`);
  }
}

const headers = (c: Pick<Creds, "token" | "clientId">) => ({
  Accept: "application/json",
  "X-Plex-Product": "MediaTrove",
  "X-Plex-Client-Identifier": c.clientId,
  ...(c.token ? { "X-Plex-Token": c.token } : {}),
});

async function get<T>(c: Creds, path: string, query: Record<string, string> = {}, extra: Record<string, string> = {}) {
  assertReadOnly("GET", path);
  const qs = new URLSearchParams(query).toString();
  return getJson<T>(`${c.server}${path}${qs ? `?${qs}` : ""}`, { headers: { ...headers(c), ...extra } }, 60_000);
}

async function plexTvSignIn(login: string, password: string, clientId: string) {
  try {
    const r = await getJson<{ user: { authToken: string } }>("https://plex.tv/users/sign_in.json", {
      method: "POST",
      headers: {
        ...headers({ clientId }),
        Authorization: `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`,
      },
    });
    return r.user.authToken;
  } catch (e) {
    if ((e as { status?: number }).status === 401) {
      throw new UserError("plex.tv rejected that sign-in. If you use two-factor sign-in, use a Plex token instead.");
    }
    throw new UserError("Couldn't reach plex.tv to sign in.");
  }
}

type Meta = {
  ratingKey: string;
  type: "movie" | "episode" | "show";
  title: string;
  year?: number;
  Guid?: { id: string }[];
  grandparentRatingKey?: string;
  parentIndex?: number;
  index?: number;
  viewCount?: number;
  viewOffset?: number;
  duration?: number;
  lastViewedAt?: number; // seconds
};
type Container = {
  MediaContainer: { size: number; totalSize?: number; Metadata?: Meta[]; Directory?: { key: string; type: string }[] };
};

/** "imdb://tt0133093", "tmdb://603", "tvdb://…" → ids. */
export function refFromGuids(kind: "movie" | "show", m: Pick<Meta, "title" | "year" | "Guid">): MediaRef {
  const ids: Record<string, string> = {};
  for (const g of m.Guid ?? []) {
    const [scheme, value] = g.id.split("://");
    if (scheme && value) ids[scheme] = value;
  }
  const num = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
  return { kind, imdb: ids.imdb, tmdb: num(ids.tmdb), tvdb: num(ids.tvdb), title: m.title, year: m.year };
}

async function all(c: Creds, section: string, type: number) {
  const out: Meta[] = [];
  for (let start = 0; ; start += 500) {
    const r = await get<Container>(
      c,
      `/library/sections/${section}/all`,
      { type: String(type), includeGuids: "1" },
      {
        "X-Plex-Container-Start": String(start),
        "X-Plex-Container-Size": "500",
      },
    );
    const page = r.MediaContainer.Metadata ?? [];
    out.push(...page);
    if (page.length < 500) return out;
  }
}

export default definePlugin<Creds>({
  manifest,

  async connect(fields) {
    const server = (fields.server ?? "").trim().replace(/\/+$/, "");
    if (!/^https?:\/\//.test(server)) throw new UserError("Server address must start with http:// or https://");
    const clientId = `mediatrove-${randomUUID()}`;
    let token = fields.token?.trim() || undefined;
    if (!token && fields.email && fields.password)
      token = await plexTvSignIn(fields.email.trim(), fields.password, clientId);
    const creds: Creds = { server, token, clientId };
    let name = "Plex";
    try {
      const id = await get<{ MediaContainer: { machineIdentifier: string } }>(creds, "/identity");
      await get<Container>(creds, "/library/sections"); // proves the token (or network) is allowed in
      name = `Plex @ ${new URL(server).host}`;
      if (!id.MediaContainer.machineIdentifier) throw new Error("not a Plex server");
    } catch (e) {
      if ((e as { status?: number }).status === 401) throw new UserError("The server didn't accept that sign-in.");
      throw new UserError(`Couldn't reach Plex at ${server}.`);
    }
    return { account: { name }, credentials: creds };
  },

  async sync(creds, rawCursor) {
    const cursor = rawCursor as SnapshotCursor;
    const sections = (await get<Container>(creds, "/library/sections")).MediaContainer.Directory ?? [];
    const entries: Entry[] = [];
    for (const s of sections) {
      if (s.type === "movie") {
        for (const m of await all(creds, s.key, 1)) entries.push(entry(m, refFromGuids("movie", m)));
      } else if (s.type === "show") {
        const shows = new Map((await all(creds, s.key, 2)).map((sh) => [sh.ratingKey, sh]));
        for (const e of await all(creds, s.key, 4)) {
          const show = e.grandparentRatingKey ? shows.get(e.grandparentRatingKey) : undefined;
          if (show && e.parentIndex && e.index) {
            entries.push({ ...entry(e, refFromGuids("show", show)), season: e.parentIndex, episode: e.index });
          }
        }
      }
    }
    // Plex lists every item, played or not, so an unmark shows up as viewCount back to 0.
    return diffSnapshot(entries, cursor);
  },
});

function entry(m: Meta, media: MediaRef): Entry {
  const count = m.viewCount ?? 0;
  return {
    id: m.ratingKey,
    media,
    played: count > 0,
    playCount: count,
    lastPlayed: m.lastViewedAt ? new Date(m.lastViewedAt * 1000).toISOString() : null,
    position: m.viewOffset && m.duration ? m.viewOffset / m.duration : null,
  };
}
