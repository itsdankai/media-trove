// For servers that only say "what's played right now" (Plex, Jellyfin, Emby, Kodi): compare this
// sync's snapshot with the last one and turn the differences into events.
import type { MediaRef, PluginEvent } from "./index.ts";

export type Entry = {
  id: string; // the server's own item id
  media: MediaRef;
  season?: number;
  episode?: number;
  played: boolean;
  playCount: number;
  lastPlayed?: string | null; // ISO
  position?: number | null; // 0..1 for unfinished items
};

/** What the plugin remembers between syncs: play counts and positions per server item. */
export type SnapshotCursor = { counts: Record<string, number>; pos: Record<string, number> } | null;

/**
 * - new or higher play count → "watched" (an item seen for the first time counts once)
 * - played before, not now → "unwatched" (MediaTrove only applies it if the user allows)
 * - a new unfinished position → "progress"
 * The first sync (no cursor) never reports unmarks.
 */
export function diffSnapshot(entries: Entry[], cursor: SnapshotCursor, now = new Date().toISOString()) {
  const first = !cursor;
  const prev = cursor ?? { counts: {}, pos: {} };
  const next: NonNullable<SnapshotCursor> = { counts: {}, pos: {} };
  const events: PluginEvent[] = [];
  const seen = new Set<string>();

  for (const e of entries) {
    seen.add(e.id);
    const ep = e.media.kind === "show" ? { season: e.season, episode: e.episode } : {};
    const known = prev.counts[e.id] ?? 0;
    const count = e.played ? Math.max(1, e.playCount) : 0;
    const at = e.lastPlayed ?? now;
    const newWatches = known === 0 ? Math.min(count, 1) : Math.max(0, count - known);
    for (let i = 0; i < newWatches; i++) {
      events.push({ media: e.media, kind: "watched", ...ep, occurredAt: new Date(Date.parse(at) - i).toISOString() });
    }
    if (!first && known > 0 && count === 0) events.push({ media: e.media, kind: "unwatched", ...ep, occurredAt: now });
    if (count > 0) next.counts[e.id] = Math.max(count, known);

    const p = !e.played && e.position && e.position > 0 && e.position < 1 ? Math.round(e.position * 1000) / 1000 : null;
    if (p != null) {
      if (prev.pos[e.id] !== p) events.push({ media: e.media, kind: "progress", ...ep, progress: p, occurredAt: at });
      next.pos[e.id] = p;
    }
  }
  return { events, cursor: next, seen };
}
