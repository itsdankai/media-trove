// Anime genres, tags and scores from anime-offline-database (manami-project, ODbL-1.0): one open
// dataset that merges AniList, MyAnimeList, Kitsu, AniDB and others, downloaded once a week and used
// offline. It replaced live AniList lookups (2026-10-06): AniList's API terms rule out use inside
// "anime/manga list/tracker services". Credit: docs/metadata-terms.md.
//
// TMDB titles are matched to its entries through the anime mapping lists the imports use (an AniList
// or MAL id). A show spanning several entries (one per season) gets their tags and genres combined and
// their scores averaged.
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadAnimeIndex } from "../imports/anime.ts";

const DATASET =
  "https://github.com/manami-project/anime-offline-database/releases/latest/download/anime-offline-database.jsonl";
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
/** Bumped when the index's shape or the tag list changes; older caches are rebuilt. */
export const ANIME_DB_VERSION = 2;

export type AnimeExtras = { genres: string[]; tags: string[]; score: number | null; v: number };

// The dataset's tags come from many sites, unranked, 50–200 per show. Genres and a curated set of tags
// people browse by are kept; the rest (cast details, art style, minor plot points) are left out.
const GENRES = [
  "Action",
  "Adventure",
  "Comedy",
  "Drama",
  "Fantasy",
  "Horror",
  "Mahou Shoujo",
  "Mecha",
  "Music",
  "Mystery",
  "Psychological",
  "Romance",
  "Sci-Fi",
  "Slice of Life",
  "Sports",
  "Supernatural",
  "Thriller",
];
const TAGS = [
  "Shounen",
  "Seinen",
  "Shoujo",
  "Josei",
  "Kids",
  "Isekai",
  "Reincarnation",
  "Mecha",
  "Military",
  "Super Power",
  "Magic",
  "Martial Arts",
  "Swordplay",
  "Samurai",
  "Ninja",
  "Gore",
  "Survival",
  "Dystopian",
  "Post-Apocalyptic",
  "Cyberpunk",
  "Space",
  "Time Travel",
  "Video Games",
  "Idol",
  "School",
  "Historical",
  "Detective",
  "Crime",
  "Revenge",
  "Tragedy",
  "Coming of Age",
  "Found Family",
  "Urban Fantasy",
  "Demons",
  "Vampire",
  "Monsters",
  "Gods",
  "Cooking",
  "Iyashikei",
  "Parody",
  "Love Triangle",
  "Harem",
  "Battle Royale",
  "Kaiju",
  "Yokai",
];
const byLower = (names: string[]) => new Map(names.map((n) => [n.toLowerCase(), n]));
const GENRE_OF = byLower(GENRES);
const TAG_OF = byLower(TAGS);
GENRE_OF.set("science fiction", "Sci-Fi");
TAG_OF.set("shonen", "Shounen");
TAG_OF.set("shojo", "Shoujo");

type Entry = { g: string[]; t: string[]; s: number | null };
type Index = {
  v: number;
  byAnilist: Record<number, Entry>;
  byMal: Record<number, Entry>;
  malToAnilist: Record<number, number>; // the same show's ids on both sites
};

// biome-ignore lint/suspicious/noExplicitAny: dataset rows are loosely typed JSON
type Json = any;

/** One dataset line -> the parts MediaTrove keeps. */
export function entryFrom(r: Json): Entry {
  const tags = (r.tags as string[] | undefined) ?? [];
  return {
    g: [...new Set(tags.map((t) => GENRE_OF.get(t)).filter(Boolean) as string[])],
    t: [...new Set(tags.map((t) => TAG_OF.get(t)).filter(Boolean) as string[])],
    s: typeof r.score?.arithmeticMean === "number" ? r.score.arithmeticMean : null,
  };
}

export function buildIndex(jsonl: string): Index {
  const idx: Index = { v: ANIME_DB_VERSION, byAnilist: {}, byMal: {}, malToAnilist: {} };
  for (const line of jsonl.split("\n")) {
    if (!line.startsWith("{") || !line.includes('"sources"')) continue;
    const r = JSON.parse(line);
    if (!Array.isArray(r.sources)) continue;
    const e = entryFrom(r);
    let anilist: number | undefined;
    let mal: number | undefined;
    for (const s of r.sources as string[]) {
      const a = s.match(/anilist\.co\/anime\/(\d+)/);
      if (a) {
        anilist = Number(a[1]);
        idx.byAnilist[anilist] = e;
      }
      const m = s.match(/myanimelist\.net\/anime\/(\d+)/);
      if (m) {
        mal = Number(m[1]);
        idx.byMal[mal] = e;
      }
    }
    if (anilist && mal) idx.malToAnilist[mal] = anilist;
  }
  return idx;
}

/** Several entries (seasons) -> one title: everything combined, scores averaged, one decimal. */
export function combine(entries: Entry[]): AnimeExtras {
  const scores = entries.map((e) => e.s).filter((s): s is number => s != null);
  return {
    genres: [...new Set(entries.flatMap((e) => e.g))],
    tags: [...new Set(entries.flatMap((e) => e.t))],
    score: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
    v: ANIME_DB_VERSION,
  };
}

export function createAnimeInfo(dataDir: string, fetchFn: typeof fetch = fetch) {
  const cacheFile = join(dataDir, "anime-db.json");
  let ready: Promise<{ idx: Index; byTmdb: Map<string, { anilist: number[]; mal: number[] }> }> | null = null;

  async function loadIndex(): Promise<Index> {
    const fresh = existsSync(cacheFile) && Date.now() - statSync(cacheFile).mtimeMs < MAX_AGE;
    if (fresh) {
      const cached = JSON.parse(readFileSync(cacheFile, "utf8")) as Index;
      if (cached.v === ANIME_DB_VERSION) return cached;
    }
    try {
      const res = await fetchFn(DATASET, { signal: AbortSignal.timeout(300_000) });
      if (!res.ok) throw new Error(`anime-offline-database returned ${res.status}`);
      const idx = buildIndex(await res.text());
      writeFileSync(cacheFile, JSON.stringify(idx));
      return idx;
    } catch (e) {
      if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, "utf8")) as Index; // old beats none
      throw e;
    }
  }

  const load = () => {
    ready ??= Promise.all([loadIndex(), loadAnimeIndex(join(dataDir, "anime-map.json"), fetchFn)])
      .then(([idx, map]) => {
        const byTmdb = new Map<string, { anilist: number[]; mal: number[] }>();
        const add = (key: string, field: "anilist" | "mal", id: number) => {
          const v = byTmdb.get(key) ?? { anilist: [], mal: [] };
          v[field].push(id);
          byTmdb.set(key, v);
        };
        for (const field of ["anilist", "mal"] as const)
          for (const [id, i] of Object.entries(map[field])) {
            const t = map.targets[i];
            if (t.tv) add(`show:${t.tv}`, field, Number(id));
            if (t.movie) add(`movie:${t.movie}`, field, Number(id));
          }
        return { idx, byTmdb };
      })
      .catch((e) => {
        ready = null;
        throw e;
      });
    return ready;
  };

  /** Genres, tags and score for a TMDB anime title, or null when the dataset doesn't have it. */
  async function extrasFor(kind: "movie" | "show", tmdbId: number): Promise<AnimeExtras | null> {
    const { idx, byTmdb } = await load();
    const ids = byTmdb.get(`${kind}:${tmdbId}`);
    if (!ids) return null;
    // An entry is often reachable by both its AniList and MAL id: count it once (by content).
    const entries = new Map<string, Entry>();
    for (const e of [...ids.anilist.map((a) => idx.byAnilist[a]), ...ids.mal.map((m) => idx.byMal[m])])
      if (e) entries.set(JSON.stringify(e), e);
    return entries.size ? combine([...entries.values()]) : null;
  }

  /** MAL id -> AniList id, offline (for MAL entries the mapping lists know only by AniList id). */
  async function anilistIdsForMal(malIds: number[]) {
    const { idx } = await load();
    return new Map(malIds.filter((m) => idx.malToAnilist[m]).map((m) => [m, idx.malToAnilist[m]]));
  }

  return { extrasFor, anilistIdsForMal };
}
