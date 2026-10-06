// Anime details from AniList (public GraphQL, no key): genres, tags (Isekai, Shounen, Seinen…) and the
// community score. TMDB files anime as plain "Animation", so for titles in the Anime section these
// replace TMDB's genres and rating. TMDB titles are matched to AniList entries with the same community
// mapping lists the imports use (imports/anime.ts); a show spanning several AniList entries (one per
// season) gets their tags combined and a score weighted by how many people rated each.
import { join } from "node:path";
import { type AnimeIndex, loadAnimeIndex } from "../imports/anime.ts";

// biome-ignore lint/suspicious/noExplicitAny: AniList responses are loosely typed JSON
type Json = any;

export type AnimeExtras = { genres: string[]; tags: string[]; score: number | null; v: number };

const TAG_RANK = 60; // AniList ranks how strongly a tag applies (0–100); below this it's incidental
/** Tag groups worth filtering by: Demographic (Shounen, Seinen…), Theme (Isekai, Mecha…), Setting. Cast
 * descriptions ("Male Protagonist") and Sexual Content aren't what people browse by. */
const SKIP_TAGS = new Set(["Heterosexual"]); // filed under Theme-Romance, but it describes the cast
const useful = (category?: string) => !category || /^(Demographic|Theme|Setting)/.test(category);
/** AniList allows about 30 requests a minute right now; one every 2.1s stays under it. */
const SPACING_MS = 2_100;
/** Stored with the extras; older lookups (before tag categories were filtered) are redone. */
export const ANILIST_VERSION = 3;

export function createAnimeInfo(dataDir: string, fetchFn: typeof fetch = fetch) {
  let index: Promise<{ idx: AnimeIndex; byTmdb: Map<string, number[]> }> | null = null;
  const load = () => {
    index ??= loadAnimeIndex(join(dataDir, "anime-map.json"), fetchFn)
      .then((idx) => {
        const byTmdb = new Map<string, number[]>();
        for (const [anilist, i] of Object.entries(idx.anilist)) {
          const t = idx.targets[i];
          for (const k of [t.tv && `show:${t.tv}`, t.movie && `movie:${t.movie}`])
            if (k) byTmdb.set(k, [...(byTmdb.get(k) ?? []), Number(anilist)]);
        }
        return { idx, byTmdb };
      })
      .catch((e) => {
        index = null;
        throw e;
      });
    return index;
  };

  // One request at a time, at least SPACING_MS apart, however many callers ask at once.
  let queue: Promise<unknown> = Promise.resolve();
  let last = 0;
  function spaced<T>(fn: () => Promise<T>): Promise<T> {
    const run = queue.then(async () => {
      const wait = last + SPACING_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      return fn();
    });
    queue = run.catch(() => {});
    return run;
  }

  /** AniList genres, tags and score for a TMDB anime title, or null when it isn't on AniList. */
  async function extrasFor(kind: "movie" | "show", tmdbId: number): Promise<AnimeExtras | null> {
    const { byTmdb } = await load();
    const ids = byTmdb.get(`${kind}:${tmdbId}`);
    if (!ids?.length) return null;
    const ask = () =>
      fetchFn("https://graphql.anilist.co", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          query: `query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids, type: ANIME) {
          id averageScore popularity genres tags { name rank category isMediaSpoiler isAdult } } } }`,
          variables: { ids: ids.slice(0, 50) },
        }),
        signal: AbortSignal.timeout(20_000),
      });
    let res = await spaced(ask);
    if (res.status === 429) {
      // Too fast anyway: wait as long as AniList asks (or a minute), then try once more.
      const wait = Number(res.headers.get("retry-after")) || 60;
      await new Promise((r) => setTimeout(r, wait * 1000));
      res = await spaced(ask);
    }
    if (!res.ok) throw new Error(`AniList returned ${res.status}`);
    const entries = ((await res.json()) as Json)?.data?.Page?.media as Json[] | undefined;
    if (!entries?.length) return null;
    return combine(entries);
  }

  return { extrasFor };
}

/** Genres and strong tags from every entry; score weighted by popularity (people who rated it). */
export function combine(entries: Json[]): AnimeExtras {
  const genres = new Set<string>();
  const tags = new Map<string, number>();
  let weighted = 0;
  let weight = 0;
  for (const e of entries) {
    for (const g of e.genres ?? []) genres.add(g);
    for (const t of e.tags ?? [])
      if (t.rank >= TAG_RANK && !t.isMediaSpoiler && !t.isAdult && useful(t.category) && !SKIP_TAGS.has(t.name))
        tags.set(t.name, Math.max(tags.get(t.name) ?? 0, t.rank));
    if (typeof e.averageScore === "number") {
      const w = Math.max(1, e.popularity ?? 1);
      weighted += e.averageScore * w;
      weight += w;
    }
  }
  return {
    genres: [...genres],
    tags: [...tags].sort((a, b) => b[1] - a[1]).map(([t]) => t),
    score: weight ? Math.round(weighted / weight) / 10 : null, // AniList scores out of 100; shown out of 10
    v: ANILIST_VERSION,
  };
}
