// Connects accounts and pulls their activity. Every plugin event is matched to a media key and
// appended to the event log with the plugin id as its source; the sync rules in events.ts decide
// what it means. Connections sync on the plugin's interval, or on demand.
import { randomUUID } from "node:crypto";
import { eq, like } from "drizzle-orm";
import type { ConnectResult, PluginEvent, SyncResult } from "../plugins/_sdk/index.ts";
import { decrypt, encrypt } from "./crypto.ts";
import { type ConnectionRow, connections, type Db, events, idMap } from "./db.ts";
import { appendEvents, type NewEvent } from "./events.ts";
import type { Library } from "./library.ts";
import type { PluginHost } from "./plugins/host.ts";

export type SyncSummary = { received: number; added: number; unmatched: number; refused: number; at: number };

export function createSync(db: Db, lib: Library, host: PluginHost, key: Buffer) {
  const running = new Map<string, Promise<SyncSummary>>();

  async function connect(pluginId: string, fields: Record<string, string>) {
    const r = await host.call<ConnectResult>(pluginId, "/connect", { fields });
    const row = {
      id: randomUUID(),
      pluginId,
      accountName: r.account.name,
      credentials: encrypt(key, r.credentials),
      cursor: null,
      createdAt: Date.now(),
    };
    db.insert(connections).values(row).run();
    return row;
  }

  const get = (id: string) => db.select().from(connections).where(eq(connections.id, id)).get();

  /** One sync of one connection. Concurrent calls for the same connection share a run. */
  function syncNow(id: string): Promise<SyncSummary> {
    const existing = running.get(id);
    if (existing) return existing;
    const run = doSync(id).finally(() => running.delete(id));
    running.set(id, run);
    return run;
  }

  const MAX_ROUNDS = 30;

  async function doSync(id: string): Promise<SyncSummary> {
    const summary: SyncSummary = { received: 0, added: 0, unmatched: 0, refused: 0, at: Date.now() };
    try {
      // A plugin with a big backlog answers `more: true`; keep going, saving after every round so
      // a crash or restart resumes where it stopped.
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const conn = get(id);
        if (!conn) throw new Error("connection not found");
        const res = await host.call<SyncResult>(conn.pluginId, "/sync", {
          credentials: decrypt(key, conn.credentials),
          cursor: conn.cursor,
        });
        const { list, unmatched } = await toEvents(conn, res.events);
        const { inserted, refused } = appendEvents(db, list);
        summary.received += res.events.length;
        summary.added += inserted;
        summary.unmatched += unmatched;
        summary.refused += refused;
        summary.at = Date.now();
        db.update(connections)
          .set({
            cursor: res.cursor ?? null,
            ...(res.credentials ? { credentials: encrypt(key, res.credentials) } : {}),
            lastSyncAt: summary.at,
            lastError: null,
            lastSummary: JSON.stringify(summary),
          })
          .where(eq(connections.id, id))
          .run();
        if (!res.more) break;
      }
      return summary;
    } catch (e) {
      db.update(connections)
        .set({ lastSyncAt: Date.now(), lastError: (e as Error).message })
        .where(eq(connections.id, id))
        .run();
      throw e;
    }
  }

  async function toEvents(conn: ConnectionRow, list: PluginEvent[]) {
    const out: NewEvent[] = [];
    let unmatched = 0;
    for (const e of list) {
      const mediaKey = await lib.resolve(e.media).catch(() => null);
      if (!mediaKey) {
        unmatched++;
        continue;
      }
      if (e.media.artwork) {
        try {
          lib.saveArtwork(mediaKey, conn.pluginId, e.media.artwork);
        } catch (err) {
          console.error("artwork:", (err as Error).message); // a bad cover never fails a sync
        }
      }
      out.push({
        mediaKey,
        kind: e.kind,
        season: e.season,
        episode: e.episode,
        progress: e.progress,
        source: conn.pluginId,
        occurredAt: new Date(e.occurredAt).toISOString(),
      });
    }
    return { list: out, unmatched };
  }

  /** Checks every 30s which connections are due, per their plugin's sync interval. */
  function schedule() {
    const tick = async () => {
      for (const c of db.select().from(connections).all()) {
        if (running.has(c.id)) continue;
        const interval = await host
          .manifest(c.pluginId)
          .then((m) => m.sync.intervalSeconds * 1000)
          .catch(() => 300_000);
        if (!c.lastSyncAt || Date.now() - c.lastSyncAt >= interval) syncNow(c.id).catch(() => {});
      }
    };
    const timer = setInterval(() => void tick(), 30_000);
    void tick();
    return () => clearInterval(timer);
  }

  function remove(id: string) {
    db.delete(connections).where(eq(connections.id, id)).run();
  }

  /**
   * Starts a connection over: forgets its cursor and re-imports everything, so better matching
   * applies to old items too. Its plugin's earlier events are dropped first (they come straight
   * back), unless another account of the same plugin shares them. The user's own entries are kept.
   */
  async function resync(id: string) {
    const conn = get(id);
    if (!conn) throw new Error("connection not found");
    const siblings = db.select().from(connections).where(eq(connections.pluginId, conn.pluginId)).all();
    if (siblings.length === 1) db.delete(events).where(eq(events.source, conn.pluginId)).run();
    // Title matches are guesses; look them up again. Id-based matches (imdb, asin) stay cached.
    db.delete(idMap).where(like(idMap.ref, "%:title%")).run();
    db.update(connections).set({ cursor: null }).where(eq(connections.id, id)).run();
    return syncNow(id);
  }

  return { connect, syncNow, resync, schedule, remove, isRunning: (id: string) => running.has(id) };
}

export type Sync = ReturnType<typeof createSync>;
