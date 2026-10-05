import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

// The event log is the source of truth: rows are only ever added. Everything the UI shows
// (watched, progress, status) is worked out from it, so any source can be replayed safely.
// Times are ISO strings for occurred_at (what happened) and epoch ms for created_at (when we stored it).

export const events = sqliteTable("events", {
  id: text("id").primaryKey(), // content hash, so the same event twice is stored once
  mediaKey: text("media_key").notNull(),
  kind: text("kind").notNull(), // watched | unwatched | progress | finished
  season: integer("season"),
  episode: integer("episode"),
  progress: real("progress"), // 0..1, audiobooks
  source: text("source").notNull(), // "manual" now; plugin ids later
  occurredAt: text("occurred_at").notNull(),
  createdAt: integer("created_at").notNull(),
});

// Cached metadata for anything that has events. Refreshed whenever its details are fetched.
export const media = sqliteTable("media", {
  key: text("key").primaryKey(), // e.g. tmdb-movie-603, audible-audiobook-B08G9PRS1K
  kind: text("kind").notNull(), // movie | show | audiobook
  title: text("title").notNull(),
  year: integer("year"),
  poster: text("poster"),
  overview: text("overview"),
  genres: text("genres", { mode: "json" }).$type<string[]>().notNull(),
  extra: text("extra", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// App settings (watched threshold, setup done). Values are JSON.
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
});

// One row per connected account. `credentials` is whatever the plugin returned from /connect
// (tokens, never passwords), encrypted with crypto.ts.
export const connections = sqliteTable("connections", {
  id: text("id").primaryKey(),
  pluginId: text("plugin_id").notNull(),
  accountName: text("account_name").notNull(),
  credentials: text("credentials").notNull(),
  cursor: text("cursor", { mode: "json" }).$type<unknown>(),
  lastSyncAt: integer("last_sync_at"),
  lastError: text("last_error"),
  lastSummary: text("last_summary"),
  createdAt: integer("created_at").notNull(),
});

// Remembers how an outside id (imdb:tt0133093, asin:B0…) maps to a media key, so each is looked up once.
export const idMap = sqliteTable("id_map", {
  ref: text("ref").primaryKey(),
  mediaKey: text("media_key"), // null = looked up, no match
  checkedAt: integer("checked_at").notNull(),
});

const ddl = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY, plugin_id TEXT NOT NULL, account_name TEXT NOT NULL, credentials TEXT NOT NULL,
  cursor TEXT, last_sync_at INTEGER, last_error TEXT, last_summary TEXT, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS id_map (ref TEXT PRIMARY KEY, media_key TEXT, checked_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, media_key TEXT NOT NULL, kind TEXT NOT NULL, season INTEGER, episode INTEGER,
  progress REAL, source TEXT NOT NULL, occurred_at TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS events_media ON events (media_key, occurred_at);
CREATE INDEX IF NOT EXISTS events_time ON events (occurred_at);
CREATE TABLE IF NOT EXISTS media (
  key TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, year INTEGER, poster TEXT, overview TEXT,
  genres TEXT NOT NULL, extra TEXT NOT NULL, updated_at INTEGER NOT NULL);
`;

export function openDb(file: string) {
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(ddl);
  return drizzle(sqlite);
}

export type Db = ReturnType<typeof openDb>;
export type EventRow = typeof events.$inferSelect;
export type MediaRow = typeof media.$inferSelect;
export type ConnectionRow = typeof connections.$inferSelect;
