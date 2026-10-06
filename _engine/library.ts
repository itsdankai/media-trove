// Media lookups shared by the API and the sync engine: which provider handles a kind, caching
// metadata rows, and matching a plugin's MediaRef to a media key (cached in id_map).
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { artwork, type Db, idMap, media } from "./db.ts";
import { ANILIST_VERSION, createAnimeInfo } from "./metadata/anilist.ts";
import {
  type MediaInfo,
  type MediaKind,
  type MediaRef,
  type MetadataProvider,
  ProviderUnavailable,
  parseKey,
} from "./metadata/types.ts";

const RETRY_MISS_MS = 24 * 60 * 60 * 1000;
/** The metadata version providers write now (tmdb.ts / audible.ts META_VERSION). */
const CURRENT_META = 3;
/** AniList extras looked up with the current tag rules (anilist.ts ANILIST_VERSION). */
const anilistCurrent = (extra: Record<string, unknown>) =>
  (extra.anilist as { v?: number } | undefined)?.v === ANILIST_VERSION;

/**
 * Where a connected app's own cover wins over the catalog's: merged editions (combined keys like
 * ASIN1+ASIN2), which the catalog only has as separate parts with "Part 1 of 2" covers.
 */
const preferSourceArt = (key: string) => key.includes("+");

export function createLibrary(
  db: Db,
  providers: MetadataProvider[],
  opts: { artworkDir?: string; dataDir?: string; fetchFn?: typeof fetch } = {},
) {
  // Anime genres, tags and scores from AniList; needs the data folder for the mapping lists.
  const animeInfo = opts.dataDir ? createAnimeInfo(opts.dataDir, opts.fetchFn) : null;
  const providerFor = (kind: MediaKind) => {
    const p = providers.find((x) => x.kinds.includes(kind));
    if (!p) throw new ProviderUnavailable(`No metadata source for ${kind}`);
    return p;
  };

  function sourcePoster(key: string) {
    if (!preferSourceArt(key)) return null;
    const art = db.select().from(artwork).where(eq(artwork.mediaKey, key)).get();
    return art ? `/api/artwork/${art.file}` : null;
  }

  /** Saves a plugin's cover (a data: URL) and, where it should win, shows it right away. */
  function saveArtwork(key: string, source: string, dataUrl: string) {
    if (!opts.artworkDir) return;
    const m = dataUrl.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/);
    if (!m) return;
    const file = `${createHash("sha1").update(`${key}|${source}`).digest("hex").slice(0, 20)}.${m[1] === "jpeg" ? "jpg" : m[1]}`;
    mkdirSync(opts.artworkDir, { recursive: true });
    writeFileSync(join(opts.artworkDir, file), Buffer.from(m[2], "base64"));
    const row = { mediaKey: key, source, file, updatedAt: Date.now() };
    db.delete(artwork)
      .where(and(eq(artwork.mediaKey, key), eq(artwork.source, source)))
      .run();
    db.insert(artwork).values(row).run();
    const poster = sourcePoster(key);
    if (poster) db.update(media).set({ poster }).where(eq(media.key, key)).run();
  }

  function upsertMedia(info: MediaInfo) {
    const extra: Record<string, unknown> = { ...info.extra, subtitle: info.subtitle ?? info.extra.subtitle ?? null };
    let genres = info.genres;
    if (extra.anime === true) {
      // Fresh TMDB details don't carry AniList's part: keep what was looked up before.
      const before = db.select().from(media).where(eq(media.key, info.key)).get();
      extra.anilist ??= before?.extra.anilist;
      // TMDB's own values, kept so AniList's can be shown instead and TMDB's still known.
      if (!("tmdbRating" in extra)) extra.tmdbRating = extra.rating ?? null;
      if (!("tmdbGenres" in extra)) extra.tmdbGenres = info.genres;
      const a = extra.anilist as { genres: string[]; tags: string[]; score: number | null } | undefined;
      const tmdbGenres = (extra.tmdbGenres as string[]).filter((g) => g !== "Animation"); // every anime has it
      genres = a?.genres.length ? a.genres : tmdbGenres;
      extra.rating = a?.score ?? extra.tmdbRating;
      extra.ratingSource = a?.score != null ? "AniList" : "TMDB";
      extra.tags = a?.tags ?? [];
    }
    const row = {
      key: info.key,
      kind: info.kind,
      title: info.title,
      year: info.year,
      poster: sourcePoster(info.key) ?? info.poster,
      overview: info.overview,
      genres,
      extra,
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

  /** The most specific id wins; title matching is the last resort. */
  function refKey(r: MediaRef) {
    const id = r.tmdb
      ? `tmdb:${r.tmdb}`
      : r.imdb
        ? `imdb:${r.imdb}`
        : r.tvdb
          ? `tvdb:${r.tvdb}`
          : r.asin
            ? `asin:${r.asin}`
            : null;
    // "title2": title refs from before edition matching (2026-10-05) are ignored and looked up again.
    const lc = (s?: string) => (s ?? "").toLowerCase();
    const byTitle = `title2:${lc(r.title)}|${lc(r.author)}|${r.year ?? ""}|${lc(r.publisher)}|${lc(r.narrator)}`;
    return `${r.kind}:${id ?? byTitle}`;
  }

  async function resolve(r: MediaRef): Promise<string | null> {
    const ref = refKey(r);
    const hit = db.select().from(idMap).where(eq(idMap.ref, ref)).get();
    if (hit && (hit.mediaKey || Date.now() - hit.checkedAt < RETRY_MISS_MS)) return hit.mediaKey;
    const p = providerFor(r.kind);
    let key = p.resolve ? await p.resolve(r) : null;
    // An ASIN not sold in this Audible region: fall back to the title.
    if (!key && r.asin && r.title && p.resolve) key = await p.resolve({ ...r, asin: undefined });
    if (key) await ensureMedia(key);
    const row = { ref, mediaKey: key, checkedAt: Date.now() };
    db.insert(idMap).values(row).onConflictDoUpdate({ target: idMap.ref, set: row }).run();
    return key;
  }

  /**
   * Fetches details again where the cache is behind: rows from before a provider added fields
   * (extra.metaVersion), and shows still airing whose next episode may have moved (daily).
   * A few at a time; a failure leaves the old row in place for the next run.
   */
  let refreshing: Promise<number> | null = null;
  function refreshStale(now = Date.now()) {
    refreshing ??= (async () => {
      const day = 24 * 60 * 60 * 1000;
      const ended = new Set(["Ended", "Canceled"]);
      const stale = db
        .select()
        .from(media)
        .all()
        .filter(
          (m) =>
            m.extra.metaVersion !== CURRENT_META ||
            (m.kind === "show" && !ended.has(String(m.extra.status)) && now - m.updatedAt > day) ||
            (m.extra.anime === true && !anilistCurrent(m.extra) && animeInfo !== null),
        );
      let done = 0;
      for (let i = 0; i < stale.length; i += 3) {
        await Promise.all(
          stale.slice(i, i + 3).map(async (m) => {
            try {
              let row =
                m.extra.metaVersion !== CURRENT_META || m.kind === "show"
                  ? upsertMedia(await providerFor(m.kind as MediaKind).details(m.key))
                  : m;
              if (row.extra.anime === true && !anilistCurrent(row.extra) && animeInfo && m.key.startsWith("tmdb-")) {
                const found = await animeInfo.extrasFor(m.kind as "movie" | "show", Number(parseKey(m.key).id));
                // Remembered even when AniList has nothing, so it isn't asked again every run.
                row = upsertMedia({
                  ...row,
                  extra: { ...row.extra, anilist: found ?? { genres: [], tags: [], score: null, v: ANILIST_VERSION } },
                } as MediaInfo);
              }
              done++;
            } catch (e) {
              console.error("refresh:", m.key, (e as Error).message);
            }
          }),
        );
      }
      return done;
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  return { providerFor, upsertMedia, ensureMedia, resolve, saveArtwork, refreshStale, artworkDir: opts.artworkDir };
}

export type Library = ReturnType<typeof createLibrary>;
