// Stremio: reads the account's library from Stremio's sync API (the same one the Stremio apps use).
// Movies: times watched + resume position. Shows: the "watched" bitfield (one bit per episode)
// decoded against Cinemeta's episode list, plus the resume position of the last episode played.
// The API is undocumented, so if Stremio changes it, only this plugin breaks.
import { inflateSync } from "node:zlib";
import { definePlugin, getJson, type Manifest, type PluginEvent, UserError } from "../_sdk/index.ts";

export const manifest: Manifest = {
  contract: 1,
  id: "stremio",
  name: "Stremio",
  version: "0.1.0",
  description: "Track movies and episodes you watch in Stremio.",
  kinds: ["movie", "show"],
  homepage: "https://www.stremio.com",
  connect: {
    fields: [
      { key: "email", label: "Stremio email", type: "email", required: true },
      {
        key: "password",
        label: "Password",
        type: "password",
        required: true,
        help: "Used once to sign in. Not stored.",
      },
    ],
    note: "Facebook/Apple sign-in accounts need a Stremio password first (stremio.com → account settings).",
  },
  sync: { intervalSeconds: 300 },
};

const API = "https://api.strem.io/api";
const CINEMETA = "https://v3-cinemeta.strem.io";

type Creds = { authKey: string };

export type LibraryItem = {
  _id: string;
  name: string;
  type: string;
  removed: boolean;
  temp: boolean;
  _mtime: string;
  state: {
    lastWatched?: string | null;
    timeOffset: number; // ms into the current video
    duration: number; // ms
    timesWatched: number;
    flaggedWatched: number;
    video_id?: string | null;
    watched?: string | null;
  };
};

export type Video = { id: string; season?: number; episode?: number; number?: number; released?: string };

type StremioReply<T> = {
  result?: T;
  error?: { code: number; message: string; wrongEmail?: boolean; wrongPass?: boolean };
};

async function call<T>(method: string, body: object): Promise<T> {
  const r = await getJson<StremioReply<T>>(`${API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (r.error) {
    if (r.error.wrongEmail || r.error.wrongPass) throw new UserError("Wrong Stremio email or password.");
    if (r.error.code === 1) throw new UserError("Stremio session expired. Reconnect Stremio.");
    throw new Error(`Stremio ${method}: ${r.error.message}`);
  }
  return r.result as T;
}

/** Stremio orders episodes by season, then episode, then release date (specials, season 0, first). */
export function orderVideos(videos: Video[]) {
  const n = (x: number | undefined) => x ?? Number.MIN_SAFE_INTEGER;
  return [...videos]
    .sort(
      (a, b) =>
        n(a.season) - n(b.season) ||
        n(a.episode ?? a.number) - n(b.episode ?? b.number) ||
        n(a.released ? Date.parse(a.released) : undefined) - n(b.released ? Date.parse(b.released) : undefined),
    )
    .map((v) => v.id);
}

/**
 * Decodes Stremio's watched field, "{anchorVideoId}:{anchorLength}:{base64 zlib bitfield}".
 * The anchor is the last watched video when it was saved; if the episode list grew since, the bits
 * are shifted so the anchor lines up again. Returns the ids of watched videos.
 */
export function decodeWatched(serialized: string, videoIds: string[]): string[] {
  const parts = serialized.split(":");
  if (parts.length < 3) return [];
  const packed = parts.pop() as string;
  const anchorLength = Number.parseInt(parts.pop() as string, 10);
  const anchorIdx = videoIds.indexOf(parts.join(":"));
  if (anchorIdx === -1) return [];
  const bytes = inflateSync(Buffer.from(packed, "base64"));
  const offset = anchorLength - 1 - anchorIdx;
  const bit = (i: number) => i >= 0 && i < anchorLength && ((bytes[i >> 3] ?? 0) & (1 << (i % 8))) !== 0;
  return videoIds.filter((_, i) => bit(i + offset));
}

export const hasActivity = (i: LibraryItem) =>
  Boolean(i.state.timesWatched || i.state.flaggedWatched || i.state.timeOffset || i.state.watched);

/** "tt0903747:5:14" → { imdb, season 5, episode 14 } */
export function parseVideoId(id: string) {
  const [imdb, s, e] = id.split(":");
  const season = Number(s);
  const episode = Number(e);
  return Number.isInteger(season) && Number.isInteger(episode) ? { imdb, season, episode } : null;
}

/**
 * Stremio keeps counts and bitfields, not dated history, so the cursor remembers what was already
 * reported (watch count per movie, watched episodes per show). Each sync reports only what's new.
 */
export type Cursor = {
  since: string;
  counts: Record<string, number>;
  episodes: Record<string, string[]>;
  retry: string[]; // item ids to try again next round
};
const emptyCursor = (): Cursor => ({ since: "", counts: {}, episodes: {}, retry: [] });

export default definePlugin<Creds>({
  manifest,

  async connect(fields) {
    if (!fields.email || !fields.password) throw new UserError("Email and password are required.");
    const r = await call<{ authKey: string; user: { email: string } }>("login", {
      type: "Login",
      email: fields.email.trim(),
      password: fields.password,
      facebook: false,
    });
    return { account: { name: r.user.email }, credentials: { authKey: r.authKey } };
  },

  async sync(creds, rawCursor) {
    const cursor = { ...emptyCursor(), ...((rawCursor as Cursor) ?? {}) };
    const items = await call<LibraryItem[]>("datastoreGet", {
      authKey: creds.authKey,
      collection: "libraryItem",
      ids: [],
      all: true,
    });
    const retry = new Set(cursor.retry);
    const todo = items
      // Not just the library: Stremio keeps anything you play without adding it as a "removed, temp"
      // item, and that's real watch history too. Only skip items with no activity at all.
      .filter((i) => hasActivity(i) && i._id.startsWith("tt") && (i._mtime > cursor.since || retry.has(i._id)))
      .sort((a, b) => a._mtime.localeCompare(b._mtime));
    const { events, done, failed } = await processBudgeted(todo, (item) => itemEvents(item, cursor));
    // Anything that failed or didn't fit in this round is retried next round, whatever its time.
    cursor.retry = [...failed, ...todo.slice(done).map((i) => i._id)];
    cursor.since = todo.slice(0, done).reduce((m, i) => (i._mtime > m ? i._mtime : m), cursor.since);
    return { events, cursor, more: done < todo.length };
  },
});

/**
 * Works through items a few at a time, stopping after a time budget so one sync never runs
 * long. A big library (hundreds of shows, each needing an episode list) takes several rounds.
 */
export async function processBudgeted<T extends { _id: string }>(
  todo: T[],
  fn: (item: T) => Promise<PluginEvent[]>,
  opts = { concurrency: 6, budgetMs: 90_000 },
) {
  const deadline = Date.now() + opts.budgetMs;
  const events: PluginEvent[] = [];
  const failed: string[] = [];
  let done = 0;
  while (done < todo.length && Date.now() < deadline) {
    const batch = todo.slice(done, done + opts.concurrency);
    const results = await Promise.allSettled(batch.map(fn));
    results.forEach((r, i) => {
      if (r.status === "fulfilled") events.push(...r.value);
      else failed.push(batch[i]._id);
    });
    done += batch.length;
  }
  return { events, done, failed };
}

/** Events for one library item, reporting only what `cursor` hasn't seen yet (and updating it). */
export async function itemEvents(
  item: LibraryItem,
  cursor: Cursor,
  fetchVideos = cinemetaVideos,
): Promise<PluginEvent[]> {
  const s = item.state;
  const at = s.lastWatched || item._mtime;
  const progress = s.duration > 0 ? Math.min(1, s.timeOffset / s.duration) : 0;
  const events: PluginEvent[] = [];

  if (item.type === "movie") {
    const media = { kind: "movie" as const, imdb: item._id, title: item.name };
    const count = Math.max(s.timesWatched, s.flaggedWatched > 0 ? 1 : 0);
    const known = cursor.counts[item._id] ?? 0;
    // First sight of an already-watched movie counts once; after that, each increase is a new viewing.
    const newWatches = known === 0 ? Math.min(count, 1) : Math.max(0, count - known);
    for (let i = 0; i < newWatches; i++) events.push({ media, kind: "watched", occurredAt: offsetIso(at, -i) });
    cursor.counts[item._id] = Math.max(count, known);
    // "Mark as watched" leaves the old position in place; don't report it as a new viewing.
    if (progress > 0 && newWatches === 0) events.push({ media, kind: "progress", progress, occurredAt: at });
    return events;
  }

  if (item.type !== "series") return [];
  const media = { kind: "show" as const, imdb: item._id, title: item.name };
  if (s.watched) {
    const videos = await fetchVideos(item._id);
    const already = new Set(cursor.episodes[item._id] ?? []);
    const watched = decodeWatched(s.watched, orderVideos(videos));
    for (const id of watched) {
      const ep = parseVideoId(id);
      if (ep && ep.season > 0 && !already.has(id)) {
        events.push({ media, kind: "watched", season: ep.season, episode: ep.episode, occurredAt: at });
      }
    }
    cursor.episodes[item._id] = [...new Set([...already, ...watched])];
  }
  const cur = s.video_id ? parseVideoId(s.video_id) : null;
  if (cur && cur.season > 0 && progress > 0) {
    events.push({ media, kind: "progress", season: cur.season, episode: cur.episode, progress, occurredAt: at });
  }
  return events;
}

const offsetIso = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();

async function cinemetaVideos(imdb: string): Promise<Video[]> {
  try {
    const r = await getJson<{ meta?: { videos?: Video[] } }>(`${CINEMETA}/meta/series/${imdb}.json`, {}, 20_000);
    return r.meta?.videos ?? [];
  } catch (e) {
    if ((e as { status?: number }).status === 404) return []; // not in Cinemeta: nothing to decode
    throw e;
  }
}
