// Movies and shows from TMDB (themoviedb.org). Needs a free key in TMDB_API_KEY:
// either the v3 "API Key" or the v4 "Read Access Token" (starts with eyJ).
// Attribution required by TMDB's terms is shown in the app footer.
import {
  type Episode,
  type MediaInfo,
  type MediaKind,
  type MetadataProvider,
  makeKey,
  ProviderUnavailable,
  parseKey,
  type SearchResult,
  type Season,
  yearOf,
} from "./types.ts";

const api = "https://api.themoviedb.org/3";
const img = (path: string | null | undefined, size = "w342") =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
const tmdbType = (kind: MediaKind) => (kind === "movie" ? "movie" : "tv");

// biome-ignore lint/suspicious/noExplicitAny: TMDB responses are loosely typed JSON
type Json = any;

export function tmdbProvider(apiKey = process.env.TMDB_API_KEY, fetchFn: typeof fetch = fetch): MetadataProvider {
  async function get(path: string, params: Record<string, string> = {}): Promise<Json> {
    if (!apiKey) throw new ProviderUnavailable("TMDB_API_KEY is not set. Add a free key from themoviedb.org to .env.");
    const bearer = apiKey.startsWith("eyJ");
    const qs = new URLSearchParams({ ...params, ...(bearer ? {} : { api_key: apiKey }) });
    const res = await fetchFn(`${api}${path}?${qs}`, {
      headers: bearer ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401) throw new ProviderUnavailable("TMDB rejected the key in TMDB_API_KEY.");
    if (!res.ok) throw new Error(`TMDB ${path} returned ${res.status}`);
    return res.json();
  }

  const toResult = (kind: MediaKind, r: Json): SearchResult => ({
    key: makeKey("tmdb", kind, r.id),
    kind,
    title: r.title ?? r.name,
    year: yearOf(r.release_date ?? r.first_air_date),
    poster: img(r.poster_path),
    overview: r.overview || null,
  });

  return {
    kinds: ["movie", "show"],

    async search(kind, q) {
      const data = await get(`/search/${tmdbType(kind)}`, { query: q, include_adult: "false" });
      return (data.results as Json[]).slice(0, 20).map((r) => toResult(kind, r));
    },

    async details(key): Promise<MediaInfo> {
      const { kind, id } = parseKey(key);
      const r = await get(`/${tmdbType(kind)}/${id}`);
      const base = { ...toResult(kind, r), genres: (r.genres as Json[]).map((g) => g.name) };
      if (kind === "movie")
        return { ...base, extra: { runtime: r.runtime ?? null, backdrop: img(r.backdrop_path, "w1280") } };
      const seasons: Season[] = (r.seasons as Json[])
        .filter((s) => s.season_number > 0) // season 0 is specials; left out of totals
        .map((s) => ({
          number: s.season_number,
          name: s.name,
          episodeCount: s.episode_count,
          airDate: s.air_date ?? null,
        }));
      const next = r.next_episode_to_air;
      return {
        ...base,
        extra: {
          backdrop: img(r.backdrop_path, "w1280"),
          seasons,
          totalEpisodes: seasons.reduce((n, s) => n + s.episodeCount, 0),
          airedEpisodes: airedCount(seasons, r.last_episode_to_air),
          status: r.status ?? null,
          nextEpisode: next
            ? { season: next.season_number, number: next.episode_number, airDate: next.air_date }
            : null,
        },
      };
    },

    async season(key, n): Promise<Episode[]> {
      const { id } = parseKey(key);
      const r = await get(`/tv/${id}/season/${n}`);
      return (r.episodes as Json[]).map((e) => ({
        season: n,
        number: e.episode_number,
        name: e.name,
        airDate: e.air_date ?? null,
        still: img(e.still_path, "w300"),
      }));
    },
  };
}

/** Episodes out so far: every episode before the last aired one, by season order. */
function airedCount(seasons: Season[], last: Json) {
  if (!last) return 0;
  return seasons.reduce((n, s) => {
    if (s.number < last.season_number) return n + s.episodeCount;
    if (s.number === last.season_number) return n + last.episode_number;
    return n;
  }, 0);
}
