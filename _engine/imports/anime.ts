// Maps anime list entries (AniList, MyAnimeList, Simkl) to TMDB. Anime trackers have one entry per
// season or cour, numbered from episode 1; TMDB usually has one show with seasons. Two community
// lists bridge that, downloaded on first use and cached for a week in <data>/anime-map.json:
//   - Anime-Lists/anime-lists: AniDB id -> TMDB show, season and episode offset (or a movie id)
//   - Fribb/anime-lists: AniList / MAL / Simkl id -> AniDB id (and a TMDB guess of its own)
// An entry with no mapping isn't guessed at (a wrong guess would mark the wrong episodes), except
// movies, which fall back to a title search.
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import type { AnimeEntry, ImportEvent } from "./types.ts";

const ANIME_LISTS = "https://raw.githubusercontent.com/Anime-Lists/anime-lists/master/anime-list-master.xml";
const FRIBB = "https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-mini.json";
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;

/** Where one anime entry lives on TMDB. season "a" = numbered straight through every season. */
export type Target = { tv?: number; movie?: number; season?: number | "a"; offset: number };

export type AnimeIndex = {
  targets: Target[];
  anidb: Record<number, number>;
  anilist: Record<number, number>;
  mal: Record<number, number>;
  simkl: Record<number, number>;
};

// biome-ignore lint/suspicious/noExplicitAny: mapping files are loosely typed JSON
type Json = any;

const int = (s: string | undefined) => {
  const n = Number.parseInt(s ?? "", 10);
  return Number.isFinite(n) ? n : undefined;
};

/** Builds the index from the two raw files. Anime-Lists' season and offset win; Fribb fills gaps. */
export function buildIndex(xml: string, fribb: Json[]): AnimeIndex {
  const idx: AnimeIndex = { targets: [], anidb: {}, anilist: {}, mal: {}, simkl: {} };
  for (const m of xml.matchAll(/<anime\s([^>]*)>/g)) {
    const a = Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
    const anidb = int(a.anidbid);
    if (!anidb) continue;
    const t: Target = {
      tv: int(a.tmdbtv),
      movie: int(a.tmdbid),
      season: a.tmdbseason === "a" ? "a" : int(a.tmdbseason),
      offset: int(a.tmdboffset) ?? 0,
    };
    if (!t.tv && !t.movie) continue;
    idx.anidb[anidb] = idx.targets.push(t) - 1;
  }
  for (const f of fribb) {
    let i = f.anidb_id != null ? idx.anidb[f.anidb_id] : undefined;
    if (i === undefined) {
      const tv = int(String(f.themoviedb_id?.tv ?? ""));
      const movie = int(String(f.themoviedb_id?.movie ?? ""));
      if (!tv && !movie) continue;
      const season = int(String(f.season?.tmdb ?? ""));
      i = idx.targets.push({ tv, movie, season, offset: 0 }) - 1;
      if (f.anidb_id != null) idx.anidb[f.anidb_id] = i;
    } else {
      const t = idx.targets[i];
      if (t.season === undefined) t.season = int(String(f.season?.tmdb ?? ""));
    }
    if (f.anilist_id != null) idx.anilist[f.anilist_id] = i;
    if (f.mal_id != null) idx.mal[f.mal_id] = i;
    if (f.simkl_id != null) idx.simkl[f.simkl_id] = i;
  }
  return idx;
}

export async function loadAnimeIndex(cacheFile: string, fetchFn: typeof fetch = fetch): Promise<AnimeIndex> {
  if (existsSync(cacheFile) && Date.now() - statSync(cacheFile).mtimeMs < MAX_AGE) {
    return JSON.parse(readFileSync(cacheFile, "utf8"));
  }
  try {
    const get = async (url: string) => {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`${url} returned ${res.status}`);
      return res.text();
    };
    const [xml, fribb] = await Promise.all([get(ANIME_LISTS), get(FRIBB)]);
    const idx = buildIndex(xml, JSON.parse(fribb));
    writeFileSync(cacheFile, JSON.stringify(idx));
    return idx;
  } catch (e) {
    // Offline or GitHub down: an old copy beats none.
    if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, "utf8"));
    throw e;
  }
}

export function targetFor(idx: AnimeIndex, ids: AnimeEntry["ids"]): Target | null {
  const i =
    (ids.anidb != null ? idx.anidb[ids.anidb] : undefined) ??
    (ids.anilist != null ? idx.anilist[ids.anilist] : undefined) ??
    (ids.mal != null ? idx.mal[ids.mal] : undefined) ??
    (ids.simkl != null ? idx.simkl[ids.simkl] : undefined);
  return i === undefined ? null : idx.targets[i];
}

/** Season sizes of a TMDB show, specials left out, for straight-through ("a") numbering. */
export type SeasonSizes = (tmdbTv: number) => Promise<{ number: number; episodeCount: number }[]>;

/** One anime entry -> TMDB events. Returns null when it can't be placed. */
export async function animeEvents(e: AnimeEntry, idx: AnimeIndex, sizes: SeasonSizes): Promise<ImportEvent[] | null> {
  const t = targetFor(idx, e.ids);
  // Listed as a show but filed on TMDB as a movie (e.g. a one-episode special): watched once all of it is.
  if (!e.movie && t?.movie && !t.tv) {
    const last = e.episodes.at(-1);
    return last ? [{ media: { kind: "movie", tmdb: t.movie }, kind: "watched", occurredAt: last.at }] : [];
  }
  if (e.movie) {
    if (!e.watchedAt) return [];
    const media = t?.movie
      ? { kind: "movie" as const, tmdb: t.movie }
      : { kind: "movie" as const, title: e.title, year: e.year };
    return [{ media, kind: "watched", occurredAt: e.watchedAt }];
  }
  if (!t?.tv || t.season === undefined) return null;
  const media = { kind: "show" as const, tmdb: t.tv };
  if (t.season !== "a") {
    return e.episodes.map((ep) => ({
      media,
      kind: "watched",
      season: t.season as number,
      episode: ep.number + t.offset,
      occurredAt: ep.at,
    }));
  }
  const seasons = (await sizes(t.tv)).filter((s) => s.number > 0).sort((a, b) => a.number - b.number);
  const out: ImportEvent[] = [];
  for (const ep of e.episodes) {
    let n = ep.number + t.offset;
    const s = seasons.find((x) => {
      if (n <= x.episodeCount) return true;
      n -= x.episodeCount;
      return false;
    });
    if (s) out.push({ media, kind: "watched", season: s.number, episode: n, occurredAt: ep.at });
  }
  return out;
}
