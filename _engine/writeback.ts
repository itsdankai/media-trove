// Keeping connected apps in sync (phase 6). For a connection set to "add" or "full", MediaTrove compares
// its own state with what the app is known to have and sends the difference to the plugin's /push.
//
// Rules (agreed with the builder, 2026-10-06):
//   - Pull first: this runs after a sync has brought the app's own marks in, never before.
//   - Latest action wins: something is sent only if MediaTrove's latest action on that movie or
//     episode is newer than the app's latest (so an unmark made in the app is never undone).
//   - Add only: watched marks only. Nothing in the app is ever unmarked.
//   - Full: also unmarks, but only ones made after the mode was turned on.
//   - No echo: the app reporting a pushed mark back is the same viewing (events.ts SAME_VIEWING).
//
// "What the app has" is its own events plus what we last pushed it (the pushes table).
import { eq, gte, inArray } from "drizzle-orm";
import type { PushItem, PushResult } from "../plugins/_sdk/index.ts";
import { decrypt, encrypt } from "./crypto.ts";
import { type ConnectionRow, connections, type Db, type EventRow, events, media, pushes } from "./db.ts";
import { eventsFor, project } from "./events.ts";
import type { Library } from "./library.ts";
import { type MediaKind, parseKey } from "./metadata/types.ts";
import type { PluginHost } from "./plugins/host.ts";
import { getSettings } from "./settings.ts";

export type SyncMode = "off" | "add" | "full";
export const syncModes = ["off", "add", "full"] as const;

export type PushSummary = { sent: number; ok: number; notFound: number; failed: number; at: number; error?: string };

/** One planned change: a movie (season/episode -1) or an episode. */
export type Planned = {
  mediaKey: string;
  season: number;
  episode: number;
  action: "watched" | "unwatched";
  at: string;
};

const BATCH = 50;

type Mark = { watched: boolean; at: string };

export function createWriteback(db: Db, lib: Library, host: PluginHost, key: Buffer) {
  const running = new Map<string, Promise<PushSummary | null>>();

  const get = (id: string) => db.select().from(connections).where(eq(connections.id, id)).get();

  /** What should be sent to this connection's app, for the given media (all when keys is null). */
  async function plan(conn: ConnectionRow, mode: SyncMode, keys: string[] | null): Promise<Planned[]> {
    if (mode === "off") return [];
    const manifest = await host.manifest(conn.pluginId);
    // Movies and shows only for now: no plugin can mark audiobooks finished yet.
    const kinds = new Set<MediaKind>(manifest.kinds.filter((k) => k !== "audiobook"));
    const threshold = getSettings(db).watchedThreshold;
    const since = conn.syncModeSince ?? conn.createdAt;
    const rows = keys
      ? keys.length
        ? db.select().from(media).where(inArray(media.key, keys)).all()
        : []
      : db.select().from(media).all();
    const sent = new Map(
      db
        .select()
        .from(pushes)
        .where(eq(pushes.connectionId, conn.id))
        .all()
        .map((p) => [`${p.mediaKey}|${p.season}|${p.episode}`, p]),
    );

    const out: Planned[] = [];
    for (const m of rows) {
      const kind = m.kind as MediaKind;
      if (!kinds.has(kind)) continue;
      const list = eventsFor(db, m.key);
      if (!list.length) continue;
      const state = project(kind, list, m.extra.airedEpisodes as number | undefined, threshold);
      const watchedNow = (s: number, e: number) =>
        kind === "movie" ? (state.watchCount ?? 0) > 0 : (state.watchedEpisodes ?? []).includes(`s${s}e${e}`);

      // Group the decisive events (marks, unmarks, and positions past the threshold) per movie/episode.
      const units = new Map<string, { s: number; e: number; mine: EventRow[]; theirs: EventRow[] }>();
      for (const ev of list) {
        const decisive =
          ev.kind === "watched" ||
          ev.kind === "unwatched" ||
          (ev.kind === "progress" && (ev.progress ?? 0) >= threshold);
        if (!decisive) continue;
        const s = kind === "movie" ? -1 : ev.season;
        const e = kind === "movie" ? -1 : ev.episode;
        if (s == null || e == null) continue;
        const u = units.get(`${s}|${e}`) ?? { s, e, mine: [], theirs: [] };
        (ev.source === conn.pluginId ? u.theirs : u.mine).push(ev);
        units.set(`${s}|${e}`, u);
      }

      for (const u of units.values()) {
        const latest = u.mine.at(-1); // MediaTrove's latest action from any other source (list is oldest first)
        if (!latest) continue; // only the app itself ever touched it: nothing to tell it
        const app = appState(u.theirs, sent.get(`${m.key}|${u.s}|${u.e}`));
        if (app && latest.occurredAt <= app.at) continue; // the app acted last: it wins
        const want = watchedNow(u.s, u.e);
        if (want && !app?.watched) {
          out.push({ mediaKey: m.key, season: u.s, episode: u.e, action: "watched", at: latest.occurredAt });
        } else if (
          mode === "full" &&
          !want &&
          app?.watched &&
          latest.kind === "unwatched" &&
          Date.parse(latest.occurredAt) > since
        ) {
          out.push({ mediaKey: m.key, season: u.s, episode: u.e, action: "unwatched", at: latest.occurredAt });
        }
      }
    }
    return out;
  }

  /** The app's latest known state: its own newest decisive event, or what we last sent, whichever is newer. */
  function appState(theirs: EventRow[], pushed?: typeof pushes.$inferSelect): Mark | null {
    const own = theirs.at(-1);
    const a: Mark | null = own ? { watched: own.kind !== "unwatched", at: own.occurredAt } : null;
    const b: Mark | null = pushed ? { watched: pushed.action === "watched", at: pushed.at } : null;
    if (!a) return b;
    if (!b) return a;
    return a.at >= b.at ? a : b;
  }

  async function toItem(p: Planned): Promise<PushItem> {
    const { kind, id } = parseKey(p.mediaKey);
    let row = db.select().from(media).where(eq(media.key, p.mediaKey)).get();
    // Cached before external ids were stored (2026-10-06): fetch the details again once.
    if (row && row.extra.imdb === undefined && p.mediaKey.startsWith("tmdb-")) {
      row = lib.upsertMedia(await lib.providerFor(kind).details(p.mediaKey));
    }
    const extra = (row?.extra ?? {}) as { imdb?: string | null; tvdb?: number | null };
    return {
      media: {
        kind: kind as "movie" | "show",
        tmdb: p.mediaKey.startsWith("tmdb-") ? Number(id) : undefined,
        imdb: extra.imdb ?? undefined,
        tvdb: extra.tvdb ?? undefined,
        title: row?.title,
        year: row?.year ?? undefined,
      },
      action: p.action,
      ...(p.season >= 0 ? { season: p.season, episode: p.episode } : {}),
      occurredAt: p.at,
    };
  }

  /** Sends what's needed to one connection's app. Runs after its sync, and after the user marks something. */
  function push(id: string): Promise<PushSummary | null> {
    const existing = running.get(id);
    if (existing) return existing;
    const run = doPush(id).finally(() => running.delete(id));
    running.set(id, run);
    return run;
  }

  async function doPush(id: string): Promise<PushSummary | null> {
    const conn = get(id);
    if (!conn || conn.syncMode === "off") return null;
    const started = Date.now();
    const keys = conn.lastPushAt
      ? [
          ...new Set(
            db
              .select({ k: events.mediaKey })
              .from(events)
              .where(gte(events.createdAt, conn.lastPushAt)) // same millisecond counts: re-checking is harmless
              .all()
              .map((r) => r.k),
          ),
        ]
      : null;
    const planned = await plan(conn, conn.syncMode as SyncMode, keys);
    const summary: PushSummary = { sent: planned.length, ok: 0, notFound: 0, failed: 0, at: started };
    let credentials = decrypt(key, conn.credentials);
    try {
      for (let i = 0; i < planned.length; i += BATCH) {
        const batch = planned.slice(i, i + BATCH);
        const items = await Promise.all(batch.map(toItem));
        const res = await host.call<PushResult>(conn.pluginId, "/push", { credentials, items });
        if (res.credentials) {
          credentials = res.credentials;
          db.update(connections)
            .set({ credentials: encrypt(key, credentials) })
            .where(eq(connections.id, id))
            .run();
        }
        batch.forEach((p, j) => {
          const r = res.results?.[j];
          if (!r?.ok && !r?.notFound) {
            summary.failed++;
            return;
          }
          if (r.notFound) summary.notFound++;
          else summary.ok++;
          const row = {
            connectionId: id,
            mediaKey: p.mediaKey,
            season: p.season,
            episode: p.episode,
            action: p.action,
            at: p.at,
            status: r.notFound ? "not_found" : "ok",
            pushedAt: Date.now(),
          };
          db.insert(pushes)
            .values(row)
            .onConflictDoUpdate({
              target: [pushes.connectionId, pushes.mediaKey, pushes.season, pushes.episode],
              set: row,
            })
            .run();
        });
      }
    } catch (e) {
      summary.error = (e as Error).message;
      summary.failed = summary.sent - summary.ok - summary.notFound;
    }
    db.update(connections)
      .set({
        // Failures are retried next time: only move on when everything got an answer.
        ...(summary.failed === 0 ? { lastPushAt: started } : {}),
        lastPushSummary: JSON.stringify(summary),
      })
      .where(eq(connections.id, id))
      .run();
    return summary;
  }

  /** Pushes to every connection that keeps its app in sync (after the user marks something). */
  let soon: NodeJS.Timeout | undefined;
  function pushAllSoon() {
    clearTimeout(soon);
    soon = setTimeout(() => {
      for (const c of db.select().from(connections).all())
        if (c.syncMode !== "off") push(c.id).catch((e) => console.error("push:", e));
    }, 2_000);
  }

  /**
   * Turning sync on without sending the past: everything that would be sent right now is recorded
   * as already settled ("skipped"), so only marks made from now on reach the app.
   */
  async function settleBacklog(id: string, mode: SyncMode) {
    const conn = get(id);
    if (!conn) throw new Error("connection not found");
    const planned = await plan({ ...conn, syncModeSince: Date.now() }, mode, null);
    const now = Date.now();
    for (const p of planned) {
      const row = { connectionId: id, ...p, status: "skipped", pushedAt: now };
      db.insert(pushes)
        .values(row)
        .onConflictDoUpdate({ target: [pushes.connectionId, pushes.mediaKey, pushes.season, pushes.episode], set: row })
        .run();
    }
    return planned.length;
  }

  /** Changes a connection's mode. Turning it on starts from scratch: everything is checked once. */
  function setMode(id: string, mode: SyncMode) {
    const conn = get(id);
    if (!conn) throw new Error("connection not found");
    const turningOn = conn.syncMode === "off" && mode !== "off";
    // Full only sends unmarks made after it was chosen, never ones from while it was Off or Add only.
    const toFull = mode === "full" && conn.syncMode !== "full";
    db.update(connections)
      .set({
        syncMode: mode,
        ...(turningOn || toFull ? { syncModeSince: Date.now() } : {}),
        ...(turningOn ? { lastPushAt: null } : {}),
      })
      .where(eq(connections.id, id))
      .run();
  }

  /** What turning a mode on would send right now: counts and a few titles, nothing sent. */
  async function preview(id: string, mode: SyncMode) {
    const conn = get(id);
    if (!conn) throw new Error("connection not found");
    const planned = await plan({ ...conn, syncModeSince: conn.syncModeSince ?? Date.now() }, mode, null);
    const titles = new Map<string, number>();
    for (const p of planned) titles.set(p.mediaKey, (titles.get(p.mediaKey) ?? 0) + 1);
    const sample = [...titles.keys()]
      .slice(0, 8)
      .map((k) => db.select().from(media).where(eq(media.key, k)).get()?.title ?? k);
    return {
      watched: planned.filter((p) => p.action === "watched").length,
      unwatched: planned.filter((p) => p.action === "unwatched").length,
      titles: titles.size,
      sample,
    };
  }

  return {
    plan,
    push,
    pushAllSoon,
    setMode,
    settleBacklog,
    preview,
    isPushing: (id: string) => running.has(id),
    /** Drops a pending pushAllSoon, so it can't run after the database is closed (account deleted). */
    stop: () => clearTimeout(soon),
  };
}

export type Writeback = ReturnType<typeof createWriteback>;
