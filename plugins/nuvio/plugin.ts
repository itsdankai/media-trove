// Nuvio: reads watched items and resume positions from a Nuvio Sync account. Nuvio's backend is
// Supabase-based; the official one is api.nuvio.tv and self-hosted ones work the same way. Each server
// publishes its public client key at /.well-known/nuvio, so the user only needs the address.
// Only read RPCs are called (sync_pull_*); nothing is ever written back.
import { definePlugin, getJson, type Manifest, msToIso, type PluginEvent, UserError } from "../_sdk/index.ts";

export const manifest: Manifest = {
  contract: 1,
  id: "nuvio",
  name: "Nuvio",
  version: "0.1.0",
  description: "Track movies and episodes from your Nuvio Sync account.",
  kinds: ["movie", "show"],
  homepage: "https://nuvio.tv",
  connect: {
    fields: [
      { key: "email", label: "Nuvio email", type: "email", required: true },
      {
        key: "password",
        label: "Password",
        type: "password",
        required: true,
        help: "Used once to sign in. Not stored.",
      },
      { key: "profile", label: "Profile number", type: "number", default: "1", help: "1 is the main profile." },
      {
        key: "server",
        label: "Server",
        type: "url",
        default: "https://api.nuvio.tv",
        help: "Change only if you self-host Nuvio.",
      },
    ],
  },
  sync: { intervalSeconds: 300 },
};

type Creds = {
  server: string;
  key: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  profile: number;
};

type Session = { access_token: string; refresh_token: string; expires_in: number; user?: { email?: string } };

export type WatchedItem = {
  content_id: string;
  content_type: string;
  title: string;
  season: number | null;
  episode: number | null;
  watched_at: number;
};
export type ProgressRow = {
  content_id: string;
  content_type: string;
  video_id: string;
  season: number | null;
  episode: number | null;
  position: number;
  duration: number;
  last_watched: number;
};

const READ_RPCS = new Set(["sync_pull_watched_items", "sync_pull_watch_progress", "sync_pull_profiles"]);

async function discover(server: string) {
  const s = server.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(s)) throw new UserError("Server must start with https://");
  try {
    const d = await getJson<{ service: string; backend_url: string; publishable_key: string }>(
      `${s}/.well-known/nuvio`,
    );
    if (d.service !== "nuvio" || !d.publishable_key) throw new Error("not a Nuvio server");
    return { server: d.backend_url.replace(/\/+$/, "") || s, key: d.publishable_key };
  } catch {
    throw new UserError(`${s} doesn't look like a Nuvio server.`);
  }
}

async function auth(server: string, key: string, grant: "password" | "refresh_token", body: object) {
  try {
    return await getJson<Session>(`${server}/auth/v1/token?grant_type=${grant}`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: key },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 400 || status === 401) {
      throw new UserError(
        grant === "password" ? "Wrong Nuvio email or password." : "Nuvio sign-in expired. Reconnect Nuvio.",
      );
    }
    throw e;
  }
}

async function rpc<T>(c: Creds, name: string, params: object): Promise<T> {
  if (!READ_RPCS.has(name)) throw new Error(`Nuvio plugin is read-only: refused ${name}`);
  return getJson<T>(`${c.server}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: c.key, Authorization: `Bearer ${c.accessToken}` },
    body: JSON.stringify(params),
  });
}

export type Cursor = { watchedSince: number; progressSince: number; watchedKeys?: string[] };

export default definePlugin<Creds>({
  manifest,

  async connect(fields) {
    const { server, key } = await discover(fields.server || "https://api.nuvio.tv");
    const s = await auth(server, key, "password", { email: fields.email?.trim(), password: fields.password });
    const profile = Math.max(1, Number(fields.profile) || 1);
    const creds: Creds = {
      server,
      key,
      accessToken: s.access_token,
      refreshToken: s.refresh_token,
      expiresAt: Date.now() + s.expires_in * 1000,
      profile,
    };
    const name = s.user?.email ?? fields.email ?? "Nuvio";
    return { account: { name: profile > 1 ? `${name} (profile ${profile})` : name }, credentials: creds };
  },

  async sync(creds, rawCursor) {
    const saved = (rawCursor ?? {}) as Partial<Cursor>;
    const cursor: Cursor = {
      watchedSince: saved.watchedSince ?? 0,
      progressSince: saved.progressSince ?? 0,
      watchedKeys: saved.watchedKeys,
    };
    let c = creds;
    let refreshed = false;
    if (Date.now() > c.expiresAt - 60_000) {
      const s = await auth(c.server, c.key, "refresh_token", { refresh_token: c.refreshToken });
      c = {
        ...c,
        accessToken: s.access_token,
        refreshToken: s.refresh_token,
        expiresAt: Date.now() + s.expires_in * 1000,
      };
      refreshed = true;
    }

    // The whole watched list every time (a few pages): comparing it with last time is the only way
    // to see unmarks, because Nuvio deletes the row instead of flagging it.
    const watched = await pullWatched(
      (page) =>
        rpc<WatchedItem[]>(c, "sync_pull_watched_items", { p_profile_id: c.profile, p_page: page, p_page_size: PAGE }),
      Number.NEGATIVE_INFINITY,
    );
    const progress = await rpc<ProgressRow[]>(c, "sync_pull_watch_progress", {
      p_profile_id: c.profile,
      p_since_last_watched: cursor.progressSince || null,
    });

    const { added, removed, keys } = diffWatched(watched, cursor.watchedKeys);
    const now = new Date().toISOString();
    const events = [
      ...added.flatMap(watchedEvent),
      ...removed.flatMap((k) => unwatchedEvent(k, now)),
      ...progress.filter((p) => p.last_watched > cursor.progressSince).flatMap(progressEvent),
    ];
    const next: Cursor = {
      watchedSince: Math.max(cursor.watchedSince, ...watched.map((w) => w.watched_at)),
      progressSince: Math.max(cursor.progressSince, ...progress.map((p) => p.last_watched)),
      watchedKeys: keys,
    };
    return { events, cursor: next, credentials: refreshed ? c : undefined };
  },
});

const keyOf = (w: Pick<WatchedItem, "content_type" | "content_id" | "season" | "episode">) =>
  [w.content_type, w.content_id, w.season ?? "", w.episode ?? ""].join("|");

/**
 * Compares this sync's watched list with the last one's keys. On the first sync (no keys yet) everything
 * counts as added and nothing as removed, so connecting never reports unmarks.
 */
export function diffWatched(watched: WatchedItem[], previous: string[] | undefined) {
  const keys = [...new Set(watched.map(keyOf))];
  if (!previous) return { added: watched, removed: [] as string[], keys };
  const before = new Set(previous);
  const nowSet = new Set(keys);
  return {
    added: watched.filter((w) => !before.has(keyOf(w))),
    removed: previous.filter((k) => !nowSet.has(k)),
    keys,
  };
}

export function unwatchedEvent(key: string, at: string): PluginEvent[] {
  const [content_type, content_id, season, episode] = key.split("|");
  const media = ref(content_id, content_type);
  if (!media) return [];
  if (media.kind === "show") {
    if (!season || !episode || Number(season) < 1) return [];
    return [{ media, kind: "unwatched", season: Number(season), episode: Number(episode), occurredAt: at }];
  }
  return [{ media, kind: "unwatched", occurredAt: at }];
}

/** Nuvio's server returns at most 1,000 rows per call, so watched items are read page by page. */
const PAGE = 1000;

/**
 * Pages are newest first, so stop at the first page that reaches items already seen (`since`),
 * or at a short page (the end). Capped at 200 pages (200,000 items).
 */
export async function pullWatched(fetchPage: (page: number) => Promise<WatchedItem[]>, since: number) {
  const all: WatchedItem[] = [];
  for (let page = 1; page <= 200; page++) {
    const rows = await fetchPage(page);
    all.push(...rows);
    if (rows.length < PAGE || rows.some((r) => r.watched_at <= since)) break;
  }
  return all;
}

const isShow = (type: string) => type === "series" || type === "show" || type === "tv";

function ref(contentId: string, type: string, title?: string) {
  const imdb = contentId.split(":")[0];
  if (!imdb.startsWith("tt")) return null; // only IMDb-keyed content can be matched for now
  return { kind: isShow(type) ? ("show" as const) : ("movie" as const), imdb, title: title || undefined };
}

export function watchedEvent(w: WatchedItem): PluginEvent[] {
  const media = ref(w.content_id, w.content_type, w.title);
  if (!media) return [];
  if (media.kind === "show") {
    if (w.season == null || w.episode == null || w.season < 1) return [];
    return [{ media, kind: "watched", season: w.season, episode: w.episode, occurredAt: msToIso(w.watched_at) }];
  }
  return [{ media, kind: "watched", occurredAt: msToIso(w.watched_at) }];
}

export function progressEvent(p: ProgressRow): PluginEvent[] {
  const media = ref(p.content_id, p.content_type);
  if (!media || p.duration <= 0 || p.position <= 0) return [];
  const progress = Math.min(1, p.position / p.duration);
  const at = msToIso(p.last_watched);
  if (media.kind === "show") {
    if (p.season == null || p.episode == null || p.season < 1) return [];
    return [{ media, kind: "progress", season: p.season, episode: p.episode, progress, occurredAt: at }];
  }
  return [{ media, kind: "progress", progress, occurredAt: at }];
}
