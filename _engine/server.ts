import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createApp } from "./app.ts";
import { openDb } from "./db.ts";
import { audibleProvider } from "./metadata/audible.ts";
import { tmdbProvider } from "./metadata/tmdb.ts";
import { appDist, dbPath, ensureDataDir } from "./paths.ts";

ensureDataDir();
const db = openDb(dbPath);
const port = Number(process.env.PORT ?? 8787);
const root = relative(process.cwd(), appDist) || ".";

const app = new Hono()
  .route("/", createApp(db, [tmdbProvider(), audibleProvider()]))
  .use("/*", serveStatic({ root }))
  // Client-side routes (/shows, /media/…) all load the same page.
  .get("*", (c) => {
    try {
      return c.html(readFileSync(join(appDist, "index.html"), "utf8"));
    } catch {
      return c.text("UI not built. Run `pnpm build`, or use `pnpm dev`.", 404);
    }
  });

serve({ fetch: app.fetch, port }, () => console.log(`MediaTrove on http://localhost:${port} (db: ${dbPath})`));
