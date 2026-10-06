// Shared by the Jellyfin and Emby plugins: both speak the "MediaBrowser" API (Jellyfin is an Emby fork).
// Read-only by construction: request() refuses anything outside READ_ONLY before any network call.
import { randomUUID } from "node:crypto";
import { getJson, type Manifest, type MediaRef, UserError } from "../_sdk/index.ts";
import { diffSnapshot, type Entry, type SnapshotCursor } from "../_sdk/snapshot.ts";

export type Creds = { server: string; token: string; userId: string; deviceId: string };

const READ_ONLY: [string, RegExp][] = [
  ["POST", /^\/Users\/AuthenticateByName$/],
  ["GET", /^\/Users\/[\w-]+\/Items$/],
  ["GET", /^\/System\/Info\/Public$/],
];

export function assertReadOnly(method: string, path: string) {
  if (!READ_ONLY.some(([m, re]) => m === method && re.test(path))) {
    throw new Error(`Media server plugin is read-only: refused ${method} ${path}`);
  }
}

const authHeader = (deviceId: string, token?: string) =>
  `MediaBrowser Client="MediaTrove", Device="MediaTrove", DeviceId="${deviceId}", Version="0.1.0"${token ? `, Token="${token}"` : ""}`;

async function request<T>(
  c: Pick<Creds, "server" | "deviceId"> & { token?: string },
  method: string,
  path: string,
  query: Record<string, string> = {},
  body?: object,
): Promise<T> {
  assertReadOnly(method, path);
  const auth = authHeader(c.deviceId, c.token);
  const qs = new URLSearchParams(query).toString();
  return getJson<T>(
    `${c.server}${path}${qs ? `?${qs}` : ""}`,
    {
      method,
      // Jellyfin reads Authorization; Emby reads X-Emby-Authorization. Send both.
      headers: {
        "content-type": "application/json",
        Authorization: auth,
        "X-Emby-Authorization": auth,
        ...(c.token ? { "X-Emby-Token": c.token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    },
    60_000,
  );
}

export function manifestFor(id: "jellyfin" | "emby", name: string, homepage: string): Manifest {
  return {
    contract: 1,
    id,
    name,
    version: "0.1.0",
    description: `Track movies and episodes you watch on your ${name} server.`,
    kinds: ["movie", "show"],
    homepage,
    connect: {
      fields: [
        {
          key: "server",
          label: "Server address",
          type: "url",
          required: true,
          placeholder: id === "jellyfin" ? "http://192.168.1.10:8096" : "http://192.168.1.10:8096",
        },
        { key: "username", label: "Username", type: "text", required: true },
        {
          key: "password",
          label: "Password",
          type: "password",
          help: "Used once to sign in. Not stored. Leave empty if your user has no password.",
        },
      ],
      note: "MediaTrove only reads what you've watched. It never changes anything on your server.",
    },
    sync: { intervalSeconds: 180 }, // servers on your own network: cheap to ask often
  };
}

export async function connect(fields: Record<string, string>, label: string) {
  const server = (fields.server ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(server)) throw new UserError("Server address must start with http:// or https://");
  const deviceId = `mediatrove-${randomUUID()}`;
  let r: { AccessToken: string; User: { Id: string; Name: string } };
  try {
    r = await request(
      { server, deviceId },
      "POST",
      "/Users/AuthenticateByName",
      {},
      { Username: fields.username, Pw: fields.password ?? "" },
    );
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 401) throw new UserError("Wrong username or password.");
    throw new UserError(`Couldn't reach ${label} at ${server}.`);
  }
  return {
    account: { name: `${r.User.Name} @ ${new URL(server).host}` },
    credentials: { server, token: r.AccessToken, userId: r.User.Id, deviceId } satisfies Creds,
  };
}

type Item = {
  Id: string;
  Name: string;
  Type: "Movie" | "Episode" | "Series";
  ProductionYear?: number;
  ProviderIds?: Record<string, string>;
  SeriesId?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  RunTimeTicks?: number;
  UserData?: { Played: boolean; PlayCount?: number; PlaybackPositionTicks?: number; LastPlayedDate?: string };
};

/** Movie/series ids from ProviderIds (key names differ in case between servers). */
export function refFrom(kind: "movie" | "show", item: Pick<Item, "Name" | "ProductionYear" | "ProviderIds">): MediaRef {
  const ids = Object.fromEntries(Object.entries(item.ProviderIds ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const num = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
  return {
    kind,
    tmdb: num(ids.tmdb),
    imdb: ids.imdb?.startsWith("tt") ? ids.imdb : undefined,
    tvdb: num(ids.tvdb),
    title: item.Name,
    year: item.ProductionYear,
  };
}

async function allItems(c: Creds, query: Record<string, string>) {
  const out: Item[] = [];
  for (let start = 0; ; start += 500) {
    const r = await request<{ Items: Item[]; TotalRecordCount: number }>(c, "GET", `/Users/${c.userId}/Items`, {
      Recursive: "true",
      Fields: "ProviderIds",
      EnableImages: "false",
      StartIndex: String(start),
      Limit: "500",
      ...query,
    });
    out.push(...r.Items);
    if (r.Items.length < 500 || out.length >= r.TotalRecordCount) return out;
  }
}

export async function sync(c: Creds, cursor: SnapshotCursor) {
  // Played items plus unfinished ones: everything that says something about what was watched.
  const [played, resumable] = await Promise.all([
    allItems(c, { IncludeItemTypes: "Movie,Episode", Filters: "IsPlayed" }),
    allItems(c, { IncludeItemTypes: "Movie,Episode", Filters: "IsResumable" }),
  ]);
  const items = new Map([...played, ...resumable].map((i) => [i.Id, i]));
  // Played last time but missing now: either unmarked (still there, unplayed) or deleted from the
  // library (gone). Ask about them directly; only the first kind becomes an unmark.
  const missing = Object.keys(cursor?.counts ?? {}).filter((id) => !items.has(id));
  for (const i of await byIds(c, missing)) items.set(i.Id, i);

  const seriesIds = [...new Set([...items.values()].map((i) => i.SeriesId).filter(Boolean))] as string[];
  const series = new Map((await byIds(c, seriesIds)).map((s) => [s.Id, s]));

  const entries: Entry[] = [];
  for (const i of items.values()) {
    const u = i.UserData ?? { Played: false };
    const base = {
      id: i.Id,
      played: u.Played,
      playCount: u.PlayCount ?? (u.Played ? 1 : 0),
      lastPlayed: u.LastPlayedDate ?? null,
      position: i.RunTimeTicks && u.PlaybackPositionTicks ? u.PlaybackPositionTicks / i.RunTimeTicks : null,
    };
    if (i.Type === "Movie") entries.push({ ...base, media: refFrom("movie", i) });
    else if (i.Type === "Episode" && i.SeriesId && series.has(i.SeriesId) && i.ParentIndexNumber && i.IndexNumber) {
      entries.push({
        ...base,
        media: refFrom("show", series.get(i.SeriesId) as Item),
        season: i.ParentIndexNumber,
        episode: i.IndexNumber,
      });
    }
  }
  return diffSnapshot(entries, cursor);
}

async function byIds(c: Creds, ids: string[]) {
  const out: Item[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const r = await request<{ Items: Item[] }>(c, "GET", `/Users/${c.userId}/Items`, {
      Ids: ids.slice(i, i + 100).join(","),
      Fields: "ProviderIds",
      EnableImages: "false",
    });
    out.push(...r.Items);
  }
  return out;
}
