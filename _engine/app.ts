import { readFileSync } from "node:fs";
import { join } from "node:path";
import { zValidator } from "@hono/zod-validator";
import { desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { BackupError, exportAll, latestBackup, restore } from "./backup.ts";
import { createCalendar } from "./calendar.ts";
import { connections, type Db, events, type MediaRow, media } from "./db.ts";
import { appendEvents, eventsFor, MANUAL, project } from "./events.ts";
import { fetchMal, parseMal } from "./imports/anime-lists.ts";
import { parseImdb, parseLetterboxd } from "./imports/csv-exports.ts";
import { readUpload } from "./imports/files.ts";
import { createImports, IMPORT_SOURCES, type ImportSource, importSourceId } from "./imports/runner.ts";
import {
  parseSimkl,
  parseSimklFiles,
  type SimklSignIn,
  simklDownload,
  simklPin,
  simklPinToken,
} from "./imports/simkl.ts";
import { parseTrakt } from "./imports/trakt.ts";
import { ImportUserError, type Parsed, type UploadFile } from "./imports/types.ts";
import { createLibrary } from "./library.ts";
import { type MediaKind, type MetadataProvider, mediaKinds, ProviderUnavailable, parseKey } from "./metadata/types.ts";
import { type PluginHost, PluginUserError } from "./plugins/host.ts";
import { getSettings, updateSettings } from "./settings.ts";
import type { Sync } from "./sync.ts";
import { syncModes, type Writeback } from "./writeback.ts";

const kindSchema = z.enum(mediaKinds);

const eventSchema = z.object({
  mediaKey: z.string().min(3),
  kind: z.enum(["watched", "unwatched", "progress", "finished"]),
  season: z.number().int().min(0).nullish(),
  episode: z.number().int().min(1).nullish(),
  progress: z.number().min(0).max(1).nullish(),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
});

export type Plugins = { host: PluginHost; sync: Sync; writeback?: Writeback };

export function createApp(
  db: Db,
  providers: MetadataProvider[],
  plugins?: Plugins,
  opts: { artworkDir?: string; dataDir?: string; fetchFn?: typeof fetch } = {},
) {
  const lib = createLibrary(db, providers, opts);
  const calendar = createCalendar(db, lib);
  const imports = opts.dataDir ? createImports(db, lib, { dataDir: opts.dataDir, fetchFn: opts.fetchFn }) : null;
  const needImports = () => {
    if (!imports) throw new ProviderUnavailable("Imports are not enabled in this instance.");
    return imports;
  };
  const simklCodes = new Map<string, SimklSignIn>(); // code shown to the user -> its sign-in
  const fileParsers: Partial<Record<ImportSource, (files: UploadFile[]) => Parsed>> = {
    trakt: parseTrakt,
    simkl: parseSimklFiles,
    letterboxd: parseLetterboxd,
    imdb: parseImdb,
  };

  const stateOf = (m: Pick<MediaRow, "key" | "kind" | "extra">, list = eventsFor(db, m.key)) =>
    project(
      m.kind as MediaKind,
      list,
      m.extra.airedEpisodes as number | undefined,
      getSettings(db).watchedThreshold,
      moreComing(m),
    );

  /**
   * "Caught up" means an episode you haven't seen is actually on its way: one is scheduled, or the
   * current season still has unaired episodes. A finished season with nothing announced reads as
   * Completed, even when TMDB calls the show "Returning" (builder, 2026-10-06: Furious S1).
   */
  const moreComing = (m: Pick<MediaRow, "kind" | "extra">) =>
    m.kind === "show" &&
    (Boolean(m.extra.nextEpisode) ||
      ((m.extra.totalEpisodes as number) ?? 0) > ((m.extra.airedEpisodes as number) ?? 0));

  const needPlugins = () => {
    if (!plugins) throw new ProviderUnavailable("Plugins are not enabled in this instance.");
    return plugins;
  };

  /** Plugin id -> display name, for "via Stremio". */
  async function sourceNames() {
    const names: Record<string, string> = { [MANUAL]: "You" };
    for (const [id, s] of Object.entries(IMPORT_SOURCES))
      names[importSourceId(id as ImportSource)] = `${s.name} import`;
    if (plugins) for (const p of await plugins.host.catalog().catch(() => [])) names[p.id] = p.name;
    return names;
  }

  const publicConnection = (c: typeof connections.$inferSelect) => ({
    id: c.id,
    pluginId: c.pluginId,
    accountName: c.accountName,
    lastSyncAt: c.lastSyncAt,
    lastError: c.lastError,
    lastSummary: c.lastSummary ? JSON.parse(c.lastSummary) : null,
    syncing: plugins?.sync.isRunning(c.id) ?? false,
    followUnmarks: c.followUnmarks,
    syncMode: c.syncMode,
    lastPushSummary: c.lastPushSummary ? JSON.parse(c.lastPushSummary) : null,
    pushing: plugins?.writeback?.isPushing(c.id) ?? false,
    createdAt: c.createdAt,
  });

  return (
    new Hono()
      .onError((err, c) => {
        if (err instanceof ProviderUnavailable) return c.json({ error: err.message }, 503);
        if (err instanceof PluginUserError || err instanceof ImportUserError || err instanceof BackupError)
          return c.json({ error: err.message }, 400);
        console.error(err);
        return c.json({ error: err.message }, 500);
      })

      .get("/api/health", (c) => c.json({ ok: true }))

      // Covers saved from connected apps (names are hashes we generated; nothing else is served).
      .get("/api/artwork/:file", (c) => {
        const file = c.req.param("file");
        if (!opts.artworkDir || !/^[a-f0-9]{20}\.(jpg|png|webp)$/.test(file)) return c.notFound();
        try {
          const body = readFileSync(join(opts.artworkDir, file));
          const type = file.endsWith(".png") ? "image/png" : file.endsWith(".webp") ? "image/webp" : "image/jpeg";
          return c.body(body, 200, { "content-type": type, "cache-control": "public, max-age=86400" });
        } catch {
          return c.notFound();
        }
      })

      .get("/api/config", (c) => c.json({ tmdb: Boolean(process.env.TMDB_API_KEY), plugins: Boolean(plugins) }))

      // --- settings -------------------------------------------------------------------------
      .get("/api/settings", (c) => c.json(getSettings(db)))

      .put(
        "/api/settings",
        zValidator(
          "json",
          z.object({ watchedThreshold: z.number().min(0.5).max(1).optional(), setupComplete: z.boolean().optional() }),
        ),
        (c) => c.json(updateSettings(db, c.req.valid("json"))),
      )

      // --- media ----------------------------------------------------------------------------
      .get("/api/search", zValidator("query", z.object({ kind: kindSchema, q: z.string().min(1) })), async (c) => {
        const { kind, q } = c.req.valid("query");
        return c.json(await lib.providerFor(kind).search(kind, q));
      })

      .get("/api/media/:key", async (c) => {
        const key = c.req.param("key");
        const info = lib.upsertMedia(await lib.providerFor(parseKey(key).kind).details(key));
        const list = eventsFor(db, key);
        const names = await sourceNames();
        const withSource = list
          .slice()
          .reverse()
          .map((e) => ({ ...e, sourceName: names[e.source] ?? e.source }));
        return c.json({ media: info, state: stateOf(info, list), events: withSource });
      })

      .get("/api/media/:key/season/:n", async (c) => {
        const key = c.req.param("key");
        const p = lib.providerFor(parseKey(key).kind);
        if (!p.season) return c.json({ error: "no seasons for this kind" }, 400);
        return c.json(await p.season(key, Number(c.req.param("n"))));
      })

      .post(
        "/api/events",
        zValidator("json", z.union([eventSchema, z.array(eventSchema).min(1).max(500)])),
        async (c) => {
          const body = c.req.valid("json");
          const list = Array.isArray(body) ? body : [body];
          for (const key of new Set(list.map((e) => e.mediaKey))) await lib.ensureMedia(key);
          const now = new Date().toISOString();
          const { inserted } = appendEvents(
            db,
            list.map((e) => ({ ...e, source: MANUAL, occurredAt: e.occurredAt ?? now })),
          );
          plugins?.writeback?.pushAllSoon(); // apps kept in sync hear about it within seconds
          return c.json({ inserted }, 201);
        },
      )

      .get(
        "/api/calendar",
        zValidator("query", z.object({ days: z.coerce.number().int().min(1).max(365).default(60) })),
        async (c) => c.json(await calendar.upcoming(c.req.valid("query").days)),
      )

      // kind=movie / kind=show leave anime out; section=anime is anime movies and shows together.
      .get(
        "/api/library",
        zValidator("query", z.object({ kind: kindSchema.optional(), section: z.enum(["anime"]).optional() })),
        (c) => {
          const { kind, section } = c.req.valid("query");
          const keys = db
            .selectDistinct({ k: events.mediaKey })
            .from(events)
            .all()
            .map((r) => r.k);
          if (!keys.length) return c.json([]);
          const rows = db
            .select()
            .from(media)
            .where(inArray(media.key, keys))
            .all()
            .filter((m) =>
              section === "anime"
                ? m.kind !== "audiobook" && m.extra.anime === true
                : (!kind || m.kind === kind) && !(kind && kind !== "audiobook" && m.extra.anime === true),
            );
          // "planned" = nothing left (e.g. unmarked everywhere). There's no watchlist yet, so it isn't shown.
          const items = rows.map((m) => ({ media: m, state: stateOf(m) })).filter((i) => i.state.status !== "planned");
          items.sort((a, b) => (b.state.lastActivityAt ?? "").localeCompare(a.state.lastActivityAt ?? ""));
          return c.json(items);
        },
      )

      .get(
        "/api/history",
        zValidator("query", z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) })),
        async (c) => {
          const { limit } = c.req.valid("query");
          const names = await sourceNames();
          const rows = db
            .select({ event: events, title: media.title, poster: media.poster, mediaKind: media.kind })
            .from(events)
            .leftJoin(media, eq(events.mediaKey, media.key))
            .orderBy(desc(events.occurredAt), desc(events.createdAt))
            .limit(limit)
            .all();
          return c.json(rows.map((r) => ({ ...r, sourceName: names[r.event.source] ?? r.event.source })));
        },
      )

      // --- backups ---------------------------------------------------------------------------
      .get("/api/backup", (c) => {
        const day = new Date().toISOString().slice(0, 10);
        return c.body(JSON.stringify(exportAll(db)), 200, {
          "content-type": "application/json",
          "content-disposition": `attachment; filename="mediatrove-${day}.json"`,
        });
      })

      .get("/api/backup/status", (c) => c.json({ latest: opts.dataDir ? latestBackup(opts.dataDir) : null }))

      .post(
        "/api/backup/restore",
        bodyLimit({
          maxSize: 200 * 1024 * 1024,
          onError: (c) => c.json({ error: "That file is too big to be a MediaTrove backup." }, 413),
        }),
        async (c) => {
          const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
          if (!(form.file instanceof File)) throw new BackupError("Choose a backup file.");
          let data: unknown;
          try {
            data = JSON.parse(await form.file.text());
          } catch {
            throw new BackupError("That file isn't a MediaTrove backup.");
          }
          return c.json(restore(db, data));
        },
      )

      // --- one-time imports -----------------------------------------------------------------
      .get("/api/imports", (c) =>
        c.json({
          sources: Object.entries(IMPORT_SOURCES).map(([id, s]) => ({ id, ...s })),
          history: needImports().history(),
          simklClientId: Boolean(process.env.SIMKL_CLIENT_ID),
        }),
      )

      .get("/api/imports/jobs/:id", (c) => {
        const job = needImports().job(c.req.param("id"));
        return job ? c.json(job) : c.notFound();
      })

      // Simkl sign-in: get a code for simkl.com/pin, then poll until the user has entered it.
      .post("/api/imports/simkl/pin", zValidator("json", z.object({ clientId: z.string().optional() })), async (c) => {
        const clientId = c.req.valid("json").clientId?.trim() || process.env.SIMKL_CLIENT_ID;
        if (!clientId) throw new ImportUserError("Enter your Simkl app's client id.");
        const { signIn, ...pin } = await simklPin(clientId);
        simklCodes.set(pin.userCode, signIn); // the device code stays on the server
        return c.json(pin);
      })

      .post("/api/imports/simkl/pin/:code", async (c) => {
        const code = c.req.param("code");
        const signIn = simklCodes.get(code);
        if (!signIn) throw new ImportUserError("That code has expired. Start again.");
        const token = await simklPinToken(signIn, code);
        if (!token) return c.json({ ready: false });
        simklCodes.delete(code);
        const job = needImports().start("simkl", "Simkl account", async () =>
          parseSimkl(await simklDownload(signIn.clientId, token)),
        );
        return c.json({ ready: true, job });
      })

      // Export files are a few MB; 100 MB is generous and keeps a bad upload from filling memory.
      .post(
        "/api/imports/:source",
        bodyLimit({
          maxSize: 100 * 1024 * 1024,
          onError: (c) => c.json({ error: "That file is too big to be an export (over 100 MB)." }, 413),
        }),
        async (c) => {
          const source = c.req.param("source") as ImportSource;
          if (!(source in IMPORT_SOURCES)) return c.notFound();
          const imp = needImports();
          if (source === "mal") {
            const body = (await c.req.json().catch(() => ({}))) as { username?: string };
            const name = body.username?.trim() ?? "";
            if (!/^[\w-]{2,40}$/.test(name)) throw new ImportUserError("Enter a username.");
            const job = imp.start(source, name, async () => parseMal(await fetchMal(name)));
            return c.json(job, 202);
          }
          const parse = fileParsers[source];
          const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
          const file = form.file;
          if (!parse || !(file instanceof File)) throw new ImportUserError("Choose the export file to upload.");
          const files = readUpload(file.name, new Uint8Array(await file.arrayBuffer()));
          const parsed = parse(files); // parsed now, so a wrong file is reported straight away
          return c.json(
            imp.start(source, file.name, async () => parsed),
            202,
          );
        },
      )

      .delete("/api/imports/:source", (c) => {
        const source = c.req.param("source") as ImportSource;
        if (!(source in IMPORT_SOURCES)) return c.notFound();
        return c.json({ removed: needImports().remove(source) });
      })

      // --- marketplace & connections ----------------------------------------------------------
      .get("/api/marketplace", zValidator("query", z.object({ q: z.string().optional() })), async (c) => {
        const { host } = needPlugins();
        const q = (c.req.valid("query").q ?? "").trim().toLowerCase();
        const counts = new Map<string, number>();
        for (const conn of db.select().from(connections).all())
          counts.set(conn.pluginId, (counts.get(conn.pluginId) ?? 0) + 1);
        const list = (await host.catalog())
          .filter(
            (p) => !q || [p.name, p.description, p.id, ...p.tags, ...p.kinds].some((s) => s.toLowerCase().includes(q)),
          )
          .map((p) => ({ ...p, connections: counts.get(p.id) ?? 0 }));
        return c.json(list);
      })

      .post("/api/marketplace/custom", zValidator("json", z.object({ url: z.url() })), async (c) => {
        const { host } = needPlugins();
        if (!host.addCustom) return c.json({ error: "not supported" }, 400);
        const m = await host.addCustom(c.req.valid("json").url);
        return c.json({ id: m.id, name: m.name }, 201);
      })

      .get("/api/plugins", (c) => c.json(needPlugins().host.statuses()))

      .get("/api/plugins/:id/manifest", async (c) => c.json(await needPlugins().host.manifest(c.req.param("id"))))

      .get("/api/connections", (c) => {
        needPlugins();
        return c.json(db.select().from(connections).all().map(publicConnection));
      })

      .post(
        "/api/connections",
        zValidator(
          "json",
          z.object({
            pluginId: z.string().min(1),
            fields: z.record(z.string(), z.string()),
            syncMode: z.enum(syncModes).optional(),
          }),
        ),
        async (c) => {
          const { sync } = needPlugins();
          const { pluginId, fields, syncMode } = c.req.valid("json");
          // Pull first: the first sync brings the app's marks in, then its afterSync push runs.
          const row = await sync.connect(pluginId, fields, syncMode ?? "off");
          sync.syncNow(row.id).catch(() => {}); // first sync runs in the background
          return c.json({ id: row.id, accountName: row.accountName }, 201);
        },
      )

      .post("/api/connections/:id/sync", async (c) => {
        const { sync } = needPlugins();
        try {
          return c.json(await sync.syncNow(c.req.param("id")));
        } catch (e) {
          return c.json({ error: (e as Error).message }, 502);
        }
      })

      .post("/api/connections/:id/resync", async (c) => {
        const { sync } = needPlugins();
        try {
          return c.json(await sync.resync(c.req.param("id")));
        } catch (e) {
          return c.json({ error: (e as Error).message }, 502);
        }
      })

      .patch(
        "/api/connections/:id",
        zValidator(
          "json",
          z.object({
            followUnmarks: z.boolean().optional(),
            syncMode: z.enum(syncModes).optional(),
            fromNow: z.boolean().optional(), // turning on: don't send the past, only new marks
          }),
        ),
        async (c) => {
          const { host, writeback } = needPlugins();
          const id = c.req.param("id");
          const { followUnmarks, syncMode, fromNow } = c.req.valid("json");
          if (followUnmarks !== undefined)
            db.update(connections).set({ followUnmarks }).where(eq(connections.id, id)).run();
          if (syncMode !== undefined) {
            const conn = db.select().from(connections).where(eq(connections.id, id)).get();
            if (!conn) return c.notFound();
            const canWrite = Boolean((await host.manifest(conn.pluginId)).capabilities?.write);
            if (syncMode !== "off" && (!canWrite || !writeback))
              return c.json({ error: "This app can't be kept in sync yet." }, 400);
            if (fromNow && syncMode !== "off" && conn.syncMode === "off") await writeback?.settleBacklog(id, syncMode);
            writeback?.setMode(id, syncMode);
            if (syncMode !== "off") writeback?.push(id).catch((e) => console.error("push:", e));
          }
          return c.json({ ok: true });
        },
      )

      // What turning on a sync mode would send to the app right now (nothing is sent).
      .get(
        "/api/connections/:id/push-preview",
        zValidator("query", z.object({ mode: z.enum(["add", "full"]) })),
        async (c) => {
          const { writeback } = needPlugins();
          if (!writeback) return c.json({ error: "not supported" }, 400);
          return c.json(await writeback.preview(c.req.param("id"), c.req.valid("query").mode));
        },
      )

      .post("/api/connections/:id/push", async (c) => {
        const { writeback } = needPlugins();
        if (!writeback) return c.json({ error: "not supported" }, 400);
        return c.json(await writeback.push(c.req.param("id")));
      })

      .delete("/api/connections/:id", (c) => {
        needPlugins().sync.remove(c.req.param("id"));
        return c.body(null, 204);
      })
  );
}

export type AppType = ReturnType<typeof createApp>;
