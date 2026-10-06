// Runs imports in the background: parse, map anime, match titles, append events under the source
// "import-<id>". Matching goes through the same library.resolve as plugins (cached in id_map), so a
// rerun is fast and stores nothing new. Finished runs are kept in the imports table for the UI.
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { desc, eq } from "drizzle-orm";
import { type Db, events, idMap, imports } from "../db.ts";
import { appendEvents, type NewEvent } from "../events.ts";
import type { Library } from "../library.ts";
import { type MediaRef, makeKey } from "../metadata/types.ts";
import { type AnimeIndex, animeEvents, loadAnimeIndex, targetFor } from "./anime.ts";
import { anilistIdsForMal } from "./anime-lists.ts";
import { type ImportEvent, ImportUserError, type Parsed } from "./types.ts";

export const IMPORT_SOURCES = {
  trakt: { name: "Trakt", input: "file" },
  simkl: { name: "Simkl", input: "simkl" },
  anilist: { name: "AniList", input: "username" },
  mal: { name: "MyAnimeList", input: "username" },
  letterboxd: { name: "Letterboxd", input: "file" },
  imdb: { name: "IMDb", input: "file" },
} as const;
export type ImportSource = keyof typeof IMPORT_SOURCES;
export const importSourceId = (s: ImportSource) => `import-${s}`;

export type ImportSummary = {
  received: number; // events found in the export
  added: number; // new events stored (0 on a rerun)
  titles: number; // distinct titles matched
  unmatched: number;
  skipped: number; // entries with nothing to import (watchlist, no date, rated series…)
};

export type ImportJob = {
  id: string;
  source: ImportSource;
  label: string;
  status: "running" | "done" | "failed";
  stage: string;
  done: number;
  total: number;
  summary: ImportSummary;
  unmatchedTitles: string[];
  notes: string[];
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
};

const CONCURRENCY = 6;
const KEEP_UNMATCHED = 100;

export function createImports(db: Db, lib: Library, opts: { dataDir: string; fetchFn?: typeof fetch }) {
  const jobs = new Map<string, ImportJob>();
  let animeIndex: Promise<AnimeIndex> | null = null;
  const anime = () => {
    animeIndex ??= loadAnimeIndex(join(opts.dataDir, "anime-map.json"), opts.fetchFn).catch((e) => {
      animeIndex = null; // try again next time
      throw e;
    });
    return animeIndex;
  };

  /** Starts an import; `load` reads the export or the profile. Returns at once with the job. */
  function start(source: ImportSource, label: string, load: () => Promise<Parsed>): ImportJob {
    const job: ImportJob = {
      id: randomUUID(),
      source,
      label,
      status: "running",
      stage: "Reading",
      done: 0,
      total: 0,
      summary: { received: 0, added: 0, titles: 0, unmatched: 0, skipped: 0 },
      unmatchedTitles: [],
      notes: [],
      error: null,
      startedAt: Date.now(),
      finishedAt: null,
    };
    jobs.set(job.id, job);
    void run(job, load);
    return job;
  }

  async function run(job: ImportJob, load: () => Promise<Parsed>) {
    try {
      const parsed = await load();
      job.summary.skipped = parsed.skipped;
      job.notes.push(...parsed.notes);
      const list: ImportEvent[] = [...parsed.events];
      const miss = (title: string) => {
        job.summary.unmatched++;
        if (job.unmatchedTitles.length < KEEP_UNMATCHED && title && !job.unmatchedTitles.includes(title))
          job.unmatchedTitles.push(title);
      };

      if (parsed.anime.length) {
        job.stage = "Mapping anime";
        job.total = parsed.anime.length;
        const idx = await anime();
        const unplaced = parsed.anime.filter((e) => e.ids.mal && !e.ids.anilist && !targetFor(idx, e.ids));
        if (unplaced.length) {
          const viaAniList = await anilistIdsForMal(
            unplaced.map((e) => e.ids.mal as number),
            opts.fetchFn,
          ).catch(() => new Map<number, number>());
          for (const e of unplaced) e.ids.anilist = viaAniList.get(e.ids.mal as number);
        }
        const sizes = async (tv: number) => {
          const m = await lib.ensureMedia(makeKey("tmdb", "show", tv));
          return (
            ((m.extra as Record<string, unknown>).seasons as { number: number; episodeCount: number }[] | undefined) ??
            []
          );
        };
        for (const e of parsed.anime) {
          const evs = await animeEvents(e, idx, sizes).catch(() => null);
          if (evs) list.push(...evs);
          else miss(e.title);
          job.done++;
        }
      }

      job.stage = "Matching titles";
      job.summary.received = list.length;
      const keyOf = await matchAll(list, job);
      job.stage = "Saving";
      const out: NewEvent[] = [];
      const matched = new Set<string>();
      const missed = new Set<string>();
      for (const e of list) {
        const hit = keyOf.get(refId(e));
        if (!hit) {
          if (!missed.has(refId(e))) miss(e.media.title ?? e.media.imdb ?? e.episodeImdb ?? "");
          missed.add(refId(e));
          continue;
        }
        matched.add(hit.key);
        out.push({
          mediaKey: hit.key,
          kind: e.kind,
          season: hit.season ?? e.season,
          episode: hit.episode ?? e.episode,
          progress: e.progress,
          source: importSourceId(job.source),
          occurredAt: e.occurredAt,
        });
      }
      job.summary.titles = matched.size;
      job.summary.added = appendEvents(db, out).inserted;
      job.status = "done";
    } catch (e) {
      job.status = "failed";
      job.error = e instanceof ImportUserError ? e.message : `Import failed: ${(e as Error).message}`;
      if (!(e instanceof ImportUserError)) console.error("import:", e);
    } finally {
      job.finishedAt = Date.now();
      job.stage = job.status === "done" ? "Done" : "Failed";
      db.insert(imports)
        .values({
          id: job.id,
          source: job.source,
          label: job.label,
          startedAt: job.startedAt,
          finishedAt: job.finishedAt,
          summary: JSON.stringify(job.summary),
          error: job.error,
        })
        .run();
    }
  }

  type Hit = { key: string; season?: number; episode?: number };
  const refId = (e: ImportEvent) => (e.episodeImdb ? `ep:${e.episodeImdb}` : JSON.stringify(e.media));

  /** Matches each distinct title once, a few at a time. */
  async function matchAll(list: ImportEvent[], job: ImportJob) {
    const unique = new Map<string, ImportEvent>();
    for (const e of list) unique.set(refId(e), e);
    const keyOf = new Map<string, Hit | null>();
    const queue = [...unique];
    job.done = 0;
    job.total = queue.length;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          const [id, e] = next;
          keyOf.set(id, await matchOne(e).catch(() => null));
          job.done++;
        }
      }),
    );
    return keyOf;
  }

  async function matchOne(e: ImportEvent): Promise<Hit | null> {
    if (!e.episodeImdb) {
      const key = await lib.resolve(e.media as MediaRef);
      return key ? { key } : null;
    }
    // An episode by its own IMDb id: cached in id_map as "<show key>|<season>|<episode>".
    const ref = `episode:imdb:${e.episodeImdb}`;
    const cached = db.select().from(idMap).where(eq(idMap.ref, ref)).get();
    let value = cached?.mediaKey ?? null;
    if (!cached) {
      const found = await lib.providerFor("show").findEpisode?.(e.episodeImdb);
      value = found ? `${found.key}|${found.season}|${found.episode}` : null;
      if (found) await lib.ensureMedia(found.key);
      db.insert(idMap).values({ ref, mediaKey: value, checkedAt: Date.now() }).onConflictDoNothing().run();
    }
    if (!value) return null;
    const [key, season, episode] = value.split("|");
    return { key, season: Number(season), episode: Number(episode) };
  }

  /** Undoes an import: drops every event it added. The user's own entries and app syncs stay. */
  function remove(source: ImportSource) {
    return db
      .delete(events)
      .where(eq(events.source, importSourceId(source)))
      .run().changes;
  }

  function history() {
    return db
      .select()
      .from(imports)
      .orderBy(desc(imports.startedAt))
      .limit(50)
      .all()
      .map((r) => ({
        ...r,
        summary: JSON.parse(r.summary) as ImportSummary,
      }));
  }

  return { start, job: (id: string) => jobs.get(id) ?? null, remove, history };
}

export type Imports = ReturnType<typeof createImports>;
