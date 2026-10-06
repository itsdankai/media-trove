import { createHash } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { type Db, type EventRow, events } from "./db.ts";
import type { MediaKind } from "./metadata/types.ts";

export type NewEvent = {
  mediaKey: string;
  kind: "watched" | "unwatched" | "progress" | "finished";
  season?: number | null;
  episode?: number | null;
  progress?: number | null;
  source: string;
  occurredAt: string;
};

export const MANUAL = "manual";
export const DEFAULT_THRESHOLD = 0.9;
/** Audiobooks count as finished at 99%: apps often stop a few seconds short (end credits) without marking them done. */
export const BOOK_DONE = 0.99;
/** Watches of the same movie or episode this close together, from any sources, are one viewing. */
export const SAME_VIEWING = 12 * 60 * 60 * 1000;

/** Same content, same id. A plugin re-sending an event it already sent changes nothing. */
export function eventId(e: NewEvent) {
  const parts = [e.source, e.mediaKey, e.kind, e.season ?? "", e.episode ?? "", e.progress ?? "", e.occurredAt];
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}

/**
 * Appends events, skipping any already stored. Sync rule 4 (amended): a plugin's "unwatched" is
 * refused unless its connection follows unmarks (`followUnmarks`), and even then it only cancels
 * what that same plugin reported (see Viewing). Returns how many were stored and how many refused.
 */
export function appendEvents(db: Db, list: NewEvent[], now = Date.now(), opts: { followUnmarks?: boolean } = {}) {
  let inserted = 0;
  let refused = 0;
  for (const e of list) {
    if (e.kind === "unwatched" && e.source !== MANUAL && !opts.followUnmarks) {
      refused++;
      continue;
    }
    const res = db
      .insert(events)
      .values({
        id: eventId(e),
        mediaKey: e.mediaKey,
        kind: e.kind,
        season: e.season ?? null,
        episode: e.episode ?? null,
        progress: e.progress ?? null,
        source: e.source,
        occurredAt: e.occurredAt,
        createdAt: now,
      })
      .onConflictDoNothing()
      .run();
    inserted += res.changes;
  }
  return { inserted, refused };
}

export function eventsFor(db: Db, mediaKey: string) {
  return db
    .select()
    .from(events)
    .where(eq(events.mediaKey, mediaKey))
    .orderBy(asc(events.occurredAt), asc(events.createdAt))
    .all();
}

export type TrackState = {
  status: "planned" | "watching" | "caught_up" | "completed" | "listening" | "finished"; // caught_up: every aired episode seen, more coming
  lastActivityAt: string | null;
  watchCount?: number; // movies
  watchedEpisodes?: string[]; // shows, as "s1e3"
  current?: { season: number; episode: number; progress: number } | null; // shows: latest unfinished episode
  progress?: number; // movies in progress, audiobooks; 0..1
};

export const episodeTag = (season: number, episode: number) => `s${season}e${episode}`;

/**
 * One viewing of one movie or episode, folded event by event (oldest first). Sync rules 2 and 3:
 * the latest progress wins; reaching the threshold counts a watch once, and dropping back below it
 * afterwards starts a new viewing instead of undoing the watch.
 */
class Viewing {
  marks: { source: string; at: number }[] = []; // counted watches, with their source so unmarks can pick
  counted = false; // has the current viewing already been counted?
  progress: number | null = null; // unfinished progress of the current viewing

  get watches() {
    return this.marks.length;
  }

  /** Apps that share state (Nuvio and Stremio) report one viewing each; within SAME_VIEWING it counts once. */
  private add(e: EventRow) {
    const at = Date.parse(e.occurredAt);
    const same = this.marks.find((m) => Math.abs(m.at - at) < SAME_VIEWING);
    if (!same) this.marks.push({ source: e.source, at });
    else if (e.source === MANUAL) same.source = MANUAL; // the user's own mark must outlive an app's unmark
  }

  apply(e: EventRow, threshold: number) {
    if (e.kind === "watched") {
      this.add(e);
      this.counted = true;
      this.progress = null;
    } else if (e.kind === "unwatched") {
      // Latest action wins (rule 4, amended twice — builder, 2026-10-06): an unmark from any app clears
      // every app's earlier marks; only the user's own marks survive it. The user's unmark clears all.
      this.marks = e.source === MANUAL ? [] : this.marks.filter((m) => m.source === MANUAL);
      this.counted = this.watches > 0;
      this.progress = null;
    } else if (e.kind === "progress" && e.progress != null) {
      if (e.progress >= threshold) {
        if (!this.counted) this.add(e);
        this.counted = true;
        this.progress = null;
      } else {
        this.counted = false;
        this.progress = e.progress > 0 ? e.progress : null;
      }
    }
  }
}

/** Folds a media item's events (oldest first) into what the UI shows. */
export function project(
  kind: MediaKind,
  list: EventRow[],
  airedEpisodes?: number,
  threshold = DEFAULT_THRESHOLD,
  airing = false, // shows: still making episodes (TMDB status isn't Ended/Canceled)
): TrackState {
  // Same instant, different kinds: a position report goes before "watched"/"finished", so marking
  // something done wins over the stale position some apps keep (Stremio keeps 29% after "mark watched").
  const rank = (k: string) => (k === "progress" ? 0 : 1);
  list = [...list].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || rank(a.kind) - rank(b.kind));
  const last = list.at(-1)?.occurredAt ?? null;

  if (kind === "movie") {
    const v = new Viewing();
    for (const e of list) v.apply(e, threshold);
    const status = v.progress != null ? "watching" : v.watches > 0 ? "completed" : "planned";
    return { status, lastActivityAt: last, watchCount: v.watches, progress: v.progress ?? undefined };
  }

  if (kind === "show") {
    const eps = new Map<string, Viewing>();
    let current: TrackState["current"] = null;
    for (const e of list) {
      if (e.season == null || e.episode == null) continue;
      const tag = episodeTag(e.season, e.episode);
      const v = eps.get(tag) ?? new Viewing();
      eps.set(tag, v);
      v.apply(e, threshold);
      if (v.progress != null) current = { season: e.season, episode: e.episode, progress: v.progress };
      else if (current && current.season === e.season && current.episode === e.episode) current = null;
    }
    // Sync rule 1: an episode is watched if any source ever completed it (same episode counts once).
    const seen = [...eps].filter(([, v]) => v.watches > 0).map(([tag]) => tag);
    const done = airedEpisodes != null && airedEpisodes > 0 && seen.length >= airedEpisodes;
    return {
      // All aired episodes seen: "caught up" while the show is still airing, "completed" once it has ended.
      // A new episode raises airedEpisodes (daily refresh), and it goes back to "watching".
      status: done ? (airing ? "caught_up" : "completed") : seen.length > 0 || current ? "watching" : "planned",
      lastActivityAt: last,
      watchedEpisodes: seen,
      current,
    };
  }

  let progress = 0;
  let finished = false;
  for (const e of list) {
    if (e.kind === "progress" && e.progress != null) {
      progress = Math.min(1, Math.max(0, e.progress));
      finished = progress >= BOOK_DONE;
    }
    if (e.kind === "finished") {
      progress = 1;
      finished = true;
    }
  }
  return { status: finished ? "finished" : progress > 0 ? "listening" : "planned", lastActivityAt: last, progress };
}
