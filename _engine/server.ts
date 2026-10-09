import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createAccounts } from "./accounts.ts";
import { weeklyBackup } from "./backup.ts";
import { emailBackup, mailer } from "./backup-email.ts";
import { loadKey } from "./crypto.ts";
import { audibleProvider } from "./metadata/audible.ts";
import { tmdbProvider } from "./metadata/tmdb.ts";
import { appDist, dataDir, ensureDataDir, projectRoot } from "./paths.ts";
import { ProcessHost } from "./plugins/host.ts";
import { createRoot } from "./root.ts";
import { createWorkspaces } from "./workspaces.ts";

ensureDataDir();
const port = Number(process.env.PORT ?? 8787);
const root = relative(process.cwd(), appDist) || ".";
const providers = [tmdbProvider(), audibleProvider()];

const host = new ProcessHost(projectRoot, {
  catalogUrl:
    process.env.MEDIATROVE_CATALOG_URL ??
    "https://raw.githubusercontent.com/itsdankai/media-trove/main/plugins/catalog.json",
  customUrls: (process.env.MEDIATROVE_PLUGIN_URLS ?? "").split(",").filter(Boolean),
});
const key = loadKey(dataDir);
const mail = mailer();
const workspaces = createWorkspaces({ dataDir, providers, host, key, schedule: true });
const accounts = createAccounts({
  file: join(dataDir, "auth.db"),
  key,
  mail,
  onFirstUser: (user) =>
    workspaces.adoptLegacy(user.id) && console.log(`library from before accounts now belongs to ${user.email}`),
  onDeleted: (user) => workspaces.remove(user.id),
});
await accounts.migrate();
workspaces.startAll();

// A backup file of each library once a week, in its backups folder (the last 8 are kept).
// The admin's is also emailed when MEDIATROVE_BACKUP_EMAIL_TO is set (backup-email.ts).
const backupNow = async () => {
  const admins = new Set(
    accounts
      .users()
      .filter((u) => u.role === "admin")
      .map((u) => u.id),
  );
  for (const [id, ws] of workspaces.all()) {
    try {
      const file = weeklyBackup(ws.db, ws.dir);
      if (!file || !admins.has(id)) continue;
      const json = readFileSync(join(ws.dir, "backups", file), "utf8");
      const b = JSON.parse(json) as { media: unknown[]; events: unknown[] };
      if (
        await emailBackup(mail, process.env.MEDIATROVE_BACKUP_EMAIL_TO, file, json, {
          titles: b.media.length,
          events: b.events.length,
        })
      )
        console.log(`backup emailed: ${file}`);
    } catch (e) {
      console.error("backup:", (e as Error).message);
    }
  }
};
void backupNow();
const backupTimer = setInterval(() => void backupNow(), 6 * 60 * 60 * 1000);

const app = new Hono()
  .route("/", createRoot({ accounts, workspaces, mail, legacyPassword: process.env.MEDIATROVE_PASSWORD }))
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
  console.log(`MediaTrove on http://localhost:${port} (data: ${dataDir})`),
);

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    clearInterval(backupTimer);
    workspaces.stopAll();
    host.stopAll();
    server.close(() => process.exit(0));
  });
}
