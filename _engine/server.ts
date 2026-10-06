import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createApp } from "./app.ts";
import { passwordGate } from "./auth.ts";
import { weeklyBackup } from "./backup.ts";
import { emailBackup, emailConfigured } from "./backup-email.ts";
import { loadKey } from "./crypto.ts";
import { openDb } from "./db.ts";
import { createLibrary } from "./library.ts";
import { audibleProvider } from "./metadata/audible.ts";
import { tmdbProvider } from "./metadata/tmdb.ts";
import { appDist, dataDir, dbPath, ensureDataDir, projectRoot } from "./paths.ts";
import { ProcessHost } from "./plugins/host.ts";
import { createSync } from "./sync.ts";
import { createWriteback } from "./writeback.ts";

ensureDataDir();
const db = openDb(dbPath);
const port = Number(process.env.PORT ?? 8787);
const root = relative(process.cwd(), appDist) || ".";
const providers = [tmdbProvider(), audibleProvider()];

const host = new ProcessHost(projectRoot, {
  catalogUrl:
    process.env.MEDIATROVE_CATALOG_URL ??
    "https://raw.githubusercontent.com/itsdankai/media-trove/main/plugins/catalog.json",
  customUrls: (process.env.MEDIATROVE_PLUGIN_URLS ?? "").split(",").filter(Boolean),
});
const artworkDir = join(dataDir, "artwork");
const key = loadKey(dataDir);
const lib = createLibrary(db, providers, { artworkDir, dataDir });
const writeback = createWriteback(db, lib, host, key);
// Pull first, then push: after each complete sync, connections kept in sync get MediaTrove's changes.
const sync = createSync(db, lib, host, key, {
  afterSync: (id) => void writeback.push(id).catch((e) => console.error("push:", e)),
});
const stopSchedule = sync.schedule();
// Keep cached metadata current: older rows gain new fields, airing shows get their next episode.
void lib.refreshStale().then((n) => n && console.log(`refreshed ${n} titles`));
const refreshTimer = setInterval(() => void lib.refreshStale(), 6 * 60 * 60 * 1000);
// A backup file of the whole library once a week, in <data>/backups (the last 8 are kept).
// Also emailed when Resend is set up (backup-email.ts).
const backupNow = async () => {
  try {
    const file = weeklyBackup(db, dataDir);
    if (!file) return;
    console.log(`backup written: ${file}`);
    if (!emailConfigured()) return;
    const json = readFileSync(join(dataDir, "backups", file), "utf8");
    const b = JSON.parse(json) as { media: unknown[]; events: unknown[] };
    await emailBackup(file, json, { titles: b.media.length, events: b.events.length });
    console.log(`backup emailed: ${file}`);
  } catch (e) {
    console.error("backup:", (e as Error).message);
  }
};
void backupNow();
const backupTimer = setInterval(() => void backupNow(), 6 * 60 * 60 * 1000);

const app = new Hono()
  .use("*", passwordGate())
  .route("/", createApp(db, providers, { host, sync, writeback }, { artworkDir, dataDir }))
  .use("/*", serveStatic({ root }))
  // Client-side routes (/shows, /media/…) all load the same page.
  .get("*", (c) => {
    try {
      return c.html(readFileSync(join(appDist, "index.html"), "utf8"));
    } catch {
      return c.text("UI not built. Run `pnpm build`, or use `pnpm dev`.", 404);
    }
  });

const server = serve({ fetch: app.fetch, port }, () =>
  console.log(`MediaTrove on http://localhost:${port} (db: ${dbPath})`),
);

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    stopSchedule();
    clearInterval(refreshTimer);
    clearInterval(backupTimer);
    host.stopAll();
    server.close(() => process.exit(0));
  });
}
