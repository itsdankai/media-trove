import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createApp } from "./app.ts";
import { loadKey } from "./crypto.ts";
import { openDb } from "./db.ts";
import { createLibrary } from "./library.ts";
import { audibleProvider } from "./metadata/audible.ts";
import { tmdbProvider } from "./metadata/tmdb.ts";
import { appDist, dataDir, dbPath, ensureDataDir, projectRoot } from "./paths.ts";
import { ProcessHost } from "./plugins/host.ts";
import { createSync } from "./sync.ts";

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
const sync = createSync(db, createLibrary(db, providers), host, loadKey(dataDir));
const stopSchedule = sync.schedule();

const app = new Hono()
  .route("/", createApp(db, providers, { host, sync }))
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
    host.stopAll();
    server.close(() => process.exit(0));
  });
}
