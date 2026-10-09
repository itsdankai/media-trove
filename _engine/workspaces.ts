// One library per person (phase 10). Each account gets its own folder, <data>/users/<id>/, holding its
// database, saved covers and weekly backups, and its own copy of the app's routes, sync and write-back.
// Nothing is shared between libraries except the metadata providers, the plugin processes and the caches
// in <data>, so no query can ever return another person's rows.
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "./app.ts";
import { openDb } from "./db.ts";
import { createLibrary } from "./library.ts";
import type { MetadataProvider } from "./metadata/types.ts";
import type { PluginHost } from "./plugins/host.ts";
import { createSync } from "./sync.ts";
import { createWriteback } from "./writeback.ts";

export type WorkspaceOptions = {
  dataDir: string;
  providers: MetadataProvider[];
  host: PluginHost;
  key: Buffer;
  schedule?: boolean; // background sync and metadata refresh (off in tests)
  fetchFn?: typeof fetch;
};

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function createWorkspaces(opts: WorkspaceOptions) {
  const usersDir = join(opts.dataDir, "users");
  const open = new Map<string, ReturnType<typeof start>>();
  const dirOf = (userId: string) => {
    if (!SAFE_ID.test(userId)) throw new Error("bad user id");
    return join(usersDir, userId);
  };

  function start(userId: string) {
    const dir = dirOf(userId);
    mkdirSync(dir, { recursive: true });
    const db = openDb(join(dir, "mediatrove.db"));
    const dirs = { artworkDir: join(dir, "artwork"), dataDir: opts.dataDir, backupDir: dir, fetchFn: opts.fetchFn };
    const lib = createLibrary(db, opts.providers, dirs);
    const writeback = createWriteback(db, lib, opts.host, opts.key);
    // Pull first, then push: after each complete sync, connections kept in sync get MediaTrove's changes.
    const sync = createSync(db, lib, opts.host, opts.key, {
      afterSync: (id) => void writeback.push(id).catch((e) => console.error("push:", e)),
    });
    const stops: (() => void)[] = [];
    if (opts.schedule) {
      stops.push(sync.schedule());
      // Keep cached metadata current: older rows gain new fields, airing shows get their next episode.
      void lib.refreshStale();
      const timer = setInterval(() => void lib.refreshStale(), 6 * 60 * 60 * 1000);
      stops.push(() => clearInterval(timer));
    }
    const app = createApp(db, opts.providers, { host: opts.host, sync, writeback }, { ...dirs, lib });
    return {
      db,
      dir,
      app,
      stop() {
        for (const s of stops) s();
        db.$client.close();
      },
    };
  }

  function get(userId: string) {
    const ws = open.get(userId) ?? start(userId);
    open.set(userId, ws);
    return ws;
  }

  return {
    get,
    /** Every existing library, so their apps keep syncing while nobody is signed in. */
    startAll() {
      if (!existsSync(usersDir)) return;
      for (const id of readdirSync(usersDir)) if (SAFE_ID.test(id)) get(id);
    },
    all: () => [...open.entries()],
    /**
     * The first account takes over the library from before accounts (<data>/mediatrove.db and its covers
     * and backups), so upgrading loses nothing.
     */
    adoptLegacy(userId: string) {
      const dir = dirOf(userId);
      if (!existsSync(join(opts.dataDir, "mediatrove.db")) || open.has(userId)) return false;
      mkdirSync(dir, { recursive: true });
      for (const name of ["mediatrove.db", "mediatrove.db-wal", "mediatrove.db-shm", "artwork", "backups"]) {
        const from = join(opts.dataDir, name);
        if (existsSync(from) && !existsSync(join(dir, name))) renameSync(from, join(dir, name));
      }
      return true;
    },
    /** Deleting an account deletes its library folder. */
    remove(userId: string) {
      open.get(userId)?.stop();
      open.delete(userId);
      rmSync(dirOf(userId), { recursive: true, force: true });
    },
    stopAll() {
      for (const ws of open.values()) ws.stop();
      open.clear();
    },
  };
}

export type Workspaces = ReturnType<typeof createWorkspaces>;
