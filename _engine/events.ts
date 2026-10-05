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

/** Same content, same id. A plugin re-sending an event it already sent changes nothing. */
export function eventId(e: NewEvent) {
  const parts = [e.source, e.mediaKey, e.kind, e.season ?? "", e.episode ?? "", e.progress ?? "", e.occurredAt];
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}

/** Appends events, skipping any already stored. Returns how many were new. */
export function appendEvents(db: Db, list: NewEvent[], now = Date.now()) {
  let inserted = 0;
  for (const e of list) {
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
  return inserted;
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
  progress?: number; // audiobooks, 0..1
};

export const episodeTag = (season: number, episode: number) => `s${season}e${episode}`;

/** Folds a media item's events (oldest first) into what the UI shows. */
export function project(kind: MediaKind, list: EventRow[], airedEpisodes?: number): TrackState {
  const last = list.at(-1)?.occurredAt ?? null;

  if (kind === "movie") {
    let watchCount = 0;
    for (const e of list) {
      if (e.kind === "watched") watchCount++;
      if (e.kind === "unwatched") watchCount = 0;
    }
    return { status: watchCount > 0 ? "completed" : "planned", lastActivityAt: last, watchCount };
  }

  if (kind === "show") {
    const seen = new Set<string>();
    for (const e of list) {
      if (e.season == null || e.episode == null) continue;
      const tag = episodeTag(e.season, e.episode);
      if (e.kind === "watched") seen.add(tag);
      if (e.kind === "unwatched") seen.delete(tag);
    }
    const done = airedEpisodes != null && airedEpisodes > 0 && seen.size >= airedEpisodes;
    return {
      status: done ? "completed" : seen.size > 0 ? "watching" : "planned",
      lastActivityAt: last,
      watchedEpisodes: [...seen],
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
