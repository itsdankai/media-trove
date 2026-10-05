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

/** Same content, same id. A plugin re-sending an event it already sent changes nothing. */
export function eventId(e: NewEvent) {
  const parts = [e.source, e.mediaKey, e.kind, e.season ?? "", e.episode ?? "", e.progress ?? "", e.occurredAt];
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}

/**
 * Appends events, skipping any already stored. Sync rule 4: only the user can unmark, so an
 * "unwatched" from any plugin is refused. Returns how many were stored and how many refused.
 */
export function appendEvents(db: Db, list: NewEvent[], now = Date.now()) {
  let inserted = 0;
  let refused = 0;
  for (const e of list) {
    if (e.kind === "unwatched" && e.source !== MANUAL) {
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
  status: "planned" | "watching" | "completed" | "listening" | "finished";
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
  watches = 0;
  counted = false; // has the current viewing already been counted?
  progress: number | null = null; // unfinished progress of the current viewing

  apply(e: EventRow, threshold: number) {
    if (e.kind === "watched") {
      this.watches++;
      this.counted = true;
      this.progress = null;
    } else if (e.kind === "unwatched") {
      this.watches = 0;
      this.counted = false;
      this.progress = null;
    } else if (e.kind === "progress" && e.progress != null) {
      if (e.progress >= threshold) {
        if (!this.counted) this.watches++;
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
): TrackState {
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
      status: done ? "completed" : seen.length > 0 || current ? "watching" : "planned",
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
      finished = progress >= 1;
    }
    if (e.kind === "finished") {
      progress = 1;
      finished = true;
    }
  }
  return { status: finished ? "finished" : progress > 0 ? "listening" : "planned", lastActivityAt: last, progress };
}
