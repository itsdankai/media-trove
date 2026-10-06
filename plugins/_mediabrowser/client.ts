// Shared by the Jellyfin and Emby plugins: both speak the "MediaBrowser" API (Jellyfin is an Emby fork).
// Every request is checked against an allowlist before any network call: reads in READ_ONLY, and the
// only writes are marking an item played or unplayed (WRITES), used by push() alone.
import { randomUUID } from "node:crypto";
import { getJson, type Manifest, type MediaRef, type PushItem, UserError } from "../_sdk/index.ts";
import { diffSnapshot, type Entry, type SnapshotCursor } from "../_sdk/snapshot.ts";

export type Creds = { server: string; token: string; userId: string; deviceId: string };

const READ_ONLY: [string, RegExp][] = [
  ["POST", /^\/Users\/AuthenticateByName$/],
  ["GET", /^\/Users\/[\w-]+\/Items$/],
  ["GET", /^\/Shows\/[\w-]+\/Episodes$/],
  ["GET", /^\/System\/Info\/Public$/],
];

const WRITES: [string, RegExp][] = [
  ["POST", /^\/Users\/[\w-]+\/PlayedItems\/[\w-]+$/],
  ["DELETE", /^\/Users\/[\w-]+\/PlayedItems\/[\w-]+$/],
];

export function assertAllowed(method: string, path: string, write = false) {
  const ok = (list: [string, RegExp][]) => list.some(([m, re]) => m === method && re.test(path));
  if (!ok(READ_ONLY) && !(write && ok(WRITES))) {
    throw new Error(`Media server plugin refused ${method} ${path}`);
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
  write = false,
): Promise<T> {
  assertAllowed(method, path, write);
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

/** write: the plugin can mark items played/unplayed (Jellyfin yes; Emby waits until it's tested). */
export function manifestFor(id: "jellyfin" | "emby", name: string, homepage: string, write = false): Manifest {
  return {
    ...(write ? { capabilities: { write: true } } : {}),
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
      note: write
        ? `MediaTrove reads what you've watched. If you choose to keep ${name} in sync, it also marks things watched on your server, and nothing else.`
        : "MediaTrove only reads what you've watched. It never changes anything on your server.",
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

/**
 * Marks items played or unplayed. The server's own id filters can't look titles up (Jellyfin ignores
 * AnyProviderIdEquals), so the library's movies and series are listed once and matched here by
 * TMDB, IMDb, then TVDB id, with title and year as the last resort.
 */
export async function push(c: Creds, items: PushItem[]) {
  const library = await allItems(c, { IncludeItemTypes: "Movie,Series" });
  const index = new Map<string, Item>();
  for (const i of library) {
    const kind = i.Type === "Movie" ? "movie" : "show";
    const r = refFrom(kind, i);
    for (const k of [r.tmdb && `tmdb:${r.tmdb}`, r.imdb && `imdb:${r.imdb}`, r.tvdb && `tvdb:${r.tvdb}`])
      if (k) index.set(`${kind}|${k}`, i);
    index.set(`${kind}|title:${i.Name.toLowerCase()}|${i.ProductionYear ?? ""}`, i);
  }
  const find = (m: MediaRef) =>
    [
      m.tmdb && `tmdb:${m.tmdb}`,
      m.imdb && `imdb:${m.imdb}`,
      m.tvdb && `tvdb:${m.tvdb}`,
      m.title && `title:${m.title.toLowerCase()}|${m.year ?? ""}`,
    ]
      .filter(Boolean)
      .map((k) => index.get(`${m.kind}|${k}`))
      .find(Boolean);

  const episodes = new Map<string, Item[]>();
  async function episodeOf(seriesId: string, season: number, episode: number) {
    if (!episodes.has(seriesId)) {
      const r = await request<{ Items: Item[] }>(c, "GET", `/Shows/${seriesId}/Episodes`, {
        UserId: c.userId,
        EnableImages: "false",
      });
      episodes.set(seriesId, r.Items);
    }
    return episodes.get(seriesId)?.find((e) => e.ParentIndexNumber === season && e.IndexNumber === episode);
  }

  const results = [];
  for (const it of items) {
    try {
      const found = find(it.media);
      const target =
        found && it.media.kind === "show" && it.season != null && it.episode != null
          ? await episodeOf(found.Id, it.season, it.episode)
          : it.media.kind === "movie"
            ? found
            : undefined;
      if (!target) {
        results.push({ ok: false, notFound: true });
        continue;
      }
      const path = `/Users/${c.userId}/PlayedItems/${target.Id}`;
      if (it.action === "watched")
        await request(c, "POST", path, { DatePlayed: it.occurredAt.replace(/\.\d+Z$/, "Z") }, undefined, true);
      else await request(c, "DELETE", path, {}, undefined, true);
      results.push({ ok: true });
    } catch (e) {
      results.push({ ok: false, error: (e as Error).message });
    }
  }
  return { results };
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
