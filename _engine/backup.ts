// Backups of the library: every title and every event (what was watched, when, from where), plus
// the watchlist and settings, as one JSON file. Connections are left out on purpose: their credentials are encrypted with
// this install's key and would be useless (and sensitive) anywhere else; reconnect apps after a restore.
//
// Restoring adds the backup's events through appendEvents, whose ids are content hashes, so restoring
// the same backup twice, or into a library that already has some of it, adds nothing twice.
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Db, events, media, settings, watchlist } from "./db.ts";
import { appendEvents, type NewEvent } from "./events.ts";

export const BACKUP_FORMAT = "mediatrove-backup";
const KEEP = 8; // weekly backups kept: about two months
const WEEK = 7 * 24 * 60 * 60 * 1000;

export function exportAll(db: Db) {
  return {
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: db.select().from(settings).all(),
    media: db.select().from(media).all(),
    watchlist: db.select().from(watchlist).all(),
    events: db
      .select()
      .from(events)
      .all()
      .map(({ createdAt: _, ...e }) => e),
  };
}

export type Backup = ReturnType<typeof exportAll>;

export class BackupError extends Error {}

/** Adds a backup's titles and events. Returns how many events were new. */
export function restore(db: Db, data: unknown) {
  const b = data as Partial<Backup>;
  if (b?.format !== BACKUP_FORMAT || !Array.isArray(b.events) || !Array.isArray(b.media))
    throw new BackupError("That file isn't a MediaTrove backup.");
  for (const m of b.media) db.insert(media).values(m).onConflictDoNothing().run();
  // Backups from before the watchlist (2026-10-07) don't have one.
  for (const w of b.watchlist ?? []) db.insert(watchlist).values(w).onConflictDoNothing().run();
  const list: NewEvent[] = b.events.map((e) => ({
    mediaKey: e.mediaKey,
    kind: e.kind as NewEvent["kind"],
    season: e.season,
    episode: e.episode,
    progress: e.progress,
    source: e.source,
    occurredAt: e.occurredAt,
  }));
  // Unmarks from apps are stored as-is here: they were already accepted when first synced.
  const { inserted } = appendEvents(db, list, Date.now(), { followUnmarks: true });
  return { titles: b.media.length, events: list.length, added: inserted };
}

/** Writes a weekly backup into <data>/backups when the newest one is a week old; keeps the last few. */
export function weeklyBackup(db: Db, dataDir: string, now = Date.now()) {
  const dir = join(dataDir, "backups");
  mkdirSync(dir, { recursive: true });
  const files = readdirSync(dir)
    .filter((f) => /^mediatrove-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  const newest = files.at(-1);
  if (newest && now - statSync(join(dir, newest)).mtimeMs < WEEK) return null;
  const file = `mediatrove-${new Date(now).toISOString().slice(0, 10)}.json`;
  writeFileSync(join(dir, file), JSON.stringify(exportAll(db)));
  for (const old of [...files, file].sort().slice(0, -KEEP)) rmSync(join(dir, old)); // rotate: only our own files
  return file;
}

export function latestBackup(dataDir: string) {
  try {
    const dir = join(dataDir, "backups");
    const newest = readdirSync(dir)
      .filter((f) => /^mediatrove-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort()
      .at(-1);
    return newest ? { file: newest, at: statSync(join(dir, newest)).mtimeMs } : null;
  } catch {
    return null;
  }
}
