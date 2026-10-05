import { zValidator } from "@hono/zod-validator";
import { desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { type Db, events, type MediaRow, media } from "./db.ts";
import { appendEvents, eventsFor, project } from "./events.ts";
import {
  type MediaInfo,
  type MediaKind,
  type MetadataProvider,
  mediaKinds,
  ProviderUnavailable,
  parseKey,
} from "./metadata/types.ts";

const kindSchema = z.enum(mediaKinds);

const eventSchema = z.object({
  mediaKey: z.string().min(3),
  kind: z.enum(["watched", "unwatched", "progress", "finished"]),
  season: z.number().int().min(0).nullish(),
  episode: z.number().int().min(1).nullish(),
  progress: z.number().min(0).max(1).nullish(),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
});

export function createApp(db: Db, providers: MetadataProvider[]) {
  const providerFor = (kind: MediaKind) => {
    const p = providers.find((x) => x.kinds.includes(kind));
    if (!p) throw new ProviderUnavailable(`No metadata source for ${kind}`);
    return p;
  };

  function upsertMedia(info: MediaInfo) {
    const row = {
      key: info.key,
      kind: info.kind,
      title: info.title,
      year: info.year,
      poster: info.poster,
      overview: info.overview,
      genres: info.genres,
      extra: { ...info.extra, subtitle: info.subtitle ?? null },
      updatedAt: Date.now(),
    };
    db.insert(media).values(row).onConflictDoUpdate({ target: media.key, set: row }).run();
    return row;
  }

  async function ensureMedia(key: string) {
    const cached = db.select().from(media).where(eq(media.key, key)).get();
    if (cached) return cached;
    return upsertMedia(await providerFor(parseKey(key).kind).details(key));
  }

  const stateOf = (m: Pick<MediaRow, "key" | "kind" | "extra">, list = eventsFor(db, m.key)) =>
    project(m.kind as MediaKind, list, m.extra.airedEpisodes as number | undefined);

  return new Hono()
    .onError((err, c) => {
      if (err instanceof ProviderUnavailable) return c.json({ error: err.message }, 503);
      console.error(err);
      return c.json({ error: err.message }, 500);
    })

    .get("/api/health", (c) => c.json({ ok: true }))

    .get("/api/config", (c) => c.json({ tmdb: Boolean(process.env.TMDB_API_KEY) }))

    .get("/api/search", zValidator("query", z.object({ kind: kindSchema, q: z.string().min(1) })), async (c) => {
      const { kind, q } = c.req.valid("query");
      return c.json(await providerFor(kind).search(kind, q));
    })

    .get("/api/media/:key", async (c) => {
      const key = c.req.param("key");
      const info = upsertMedia(await providerFor(parseKey(key).kind).details(key));
      const list = eventsFor(db, key);
      return c.json({ media: info, state: stateOf(info, list), events: list.slice().reverse() });
    })

    .get("/api/media/:key/season/:n", async (c) => {
      const key = c.req.param("key");
      const p = providerFor(parseKey(key).kind);
      if (!p.season) return c.json({ error: "no seasons for this kind" }, 400);
      return c.json(await p.season(key, Number(c.req.param("n"))));
    })

    .post(
      "/api/events",
      zValidator("json", z.union([eventSchema, z.array(eventSchema).min(1).max(500)])),
      async (c) => {
        const body = c.req.valid("json");
        const list = Array.isArray(body) ? body : [body];
        for (const key of new Set(list.map((e) => e.mediaKey))) await ensureMedia(key);
        const now = new Date().toISOString();
        const inserted = appendEvents(
          db,
          list.map((e) => ({ ...e, source: "manual", occurredAt: e.occurredAt ?? now })),
        );
        return c.json({ inserted }, 201);
      },
    )

    .get("/api/library", zValidator("query", z.object({ kind: kindSchema.optional() })), (c) => {
      const { kind } = c.req.valid("query");
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
        .filter((m) => !kind || m.kind === kind);
      const items = rows.map((m) => ({ media: m, state: stateOf(m) }));
      items.sort((a, b) => (b.state.lastActivityAt ?? "").localeCompare(a.state.lastActivityAt ?? ""));
      return c.json(items);
    })

    .get(
      "/api/history",
      zValidator("query", z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) })),
      (c) => {
        const { limit } = c.req.valid("query");
        const rows = db
          .select({ event: events, title: media.title, poster: media.poster, mediaKind: media.kind })
          .from(events)
          .leftJoin(media, eq(events.mediaKey, media.key))
          .orderBy(desc(events.occurredAt), desc(events.createdAt))
          .limit(limit)
          .all();
        return c.json(rows);
      },
    );
}

export type AppType = ReturnType<typeof createApp>;
