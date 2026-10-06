// AniList and MyAnimeList, read from a public profile by username (no sign-in, no key). Both count
// episodes watched per entry without per-episode dates, so every episode gets the entry's date:
// finished, else started, else last updated. Anime only; manga waits for comics (after v0.1).
import { emptyParsed, ImportUserError, isoFrom, numOr, type Parsed } from "./types.ts";

// biome-ignore lint/suspicious/noExplicitAny: API responses are loosely typed JSON
type Json = any;

const episodes = (count: number, at: string) => Array.from({ length: count }, (_, i) => ({ number: i + 1, at }));

// --- AniList ---------------------------------------------------------------------------------

const ANILIST_QUERY = `query ($name: String) {
  MediaListCollection(userName: $name, type: ANIME) {
    lists { entries {
      status progress updatedAt
      startedAt { year month day } completedAt { year month day }
      media { id idMal format episodes title { romaji english } startDate { year } }
    } }
  }
}`;

const fuzzyDate = (d: Json) =>
  d?.year && d.month && d.day
    ? isoFrom(`${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`)
    : null;

export async function fetchAniList(name: string, fetchFn: typeof fetch = fetch): Promise<Json> {
  const res = await fetchFn("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: ANILIST_QUERY, variables: { name } }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => null)) as Json;
  const err = body?.errors?.[0]?.message as string | undefined;
  if (err === "Private User")
    throw new ImportUserError(`${name}'s AniList is private. Make it public, then try again.`);
  if (res.status === 404 || err?.includes("not found") || err === "User not found")
    throw new ImportUserError(`No AniList user called ${name}.`);
  if (!res.ok || !body?.data) throw new Error(`AniList returned ${res.status}${err ? `: ${err}` : ""}`);
  return body.data;
}

/**
 * MAL id -> AniList id, 50 at a time. The mapping lists sometimes know a show only by its AniList id,
 * and AniList knows every MAL id. Used for MAL (and Simkl) entries the lists couldn't place.
 */
export async function anilistIdsForMal(malIds: number[], fetchFn: typeof fetch = fetch) {
  const out = new Map<number, number>();
  for (let i = 0; i < malIds.length; i += 50) {
    const res = await fetchFn("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        query: "query ($ids: [Int]) { Page(perPage: 50) { media(idMal_in: $ids, type: ANIME) { id idMal } } }",
        variables: { ids: malIds.slice(i, i + 50) },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) break; // best effort: a miss here just leaves those entries unmatched
    const body = (await res.json()) as Json;
    for (const m of body?.data?.Page?.media ?? []) if (m.idMal) out.set(m.idMal, m.id);
  }
  return out;
}

export function parseAniList(data: Json): Parsed {
  const out = emptyParsed();
  for (const list of data?.MediaListCollection?.lists ?? []) {
    for (const e of list?.entries ?? []) {
      const m = e?.media;
      // Music videos and promos aren't shows or movies on TMDB.
      if (!m || e.status === "PLANNING" || m.format === "MUSIC") {
        out.skipped++;
        continue;
      }
      const at = fuzzyDate(e.completedAt) ?? fuzzyDate(e.startedAt) ?? isoFrom(e.updatedAt);
      const done = e.status === "COMPLETED" || e.status === "REPEATING";
      const movie = m.format === "MOVIE";
      const count = done && !movie ? Math.max(e.progress ?? 0, m.episodes ?? 0) : (e.progress ?? 0);
      if (!at || (movie ? !done : count <= 0)) {
        out.skipped++;
        continue;
      }
      out.anime.push({
        ids: { anilist: m.id, mal: numOr(m.idMal) },
        title: m.title?.english || m.title?.romaji || "",
        year: numOr(m.startDate?.year),
        movie,
        episodes: movie ? [] : episodes(count, at),
        watchedAt: movie ? at : null,
      });
    }
  }
  return out;
}

// --- MyAnimeList -----------------------------------------------------------------------------

// MAL's own list page loads this JSON, 300 entries at a time; status 7 = all. Public lists only.
const MAL_STATUS = { watching: 1, completed: 2, onHold: 3, dropped: 4, planned: 6 } as const;

export async function fetchMal(name: string, fetchFn: typeof fetch = fetch): Promise<Json[]> {
  const all: Json[] = [];
  for (let offset = 0; offset < 20_000; offset += 300) {
    const url = `https://myanimelist.net/animelist/${encodeURIComponent(name)}/load.json?offset=${offset}&status=7`;
    const res = await fetchFn(url, {
      headers: { Accept: "application/json", "User-Agent": "MediaTrove (self-hosted media tracker)" },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 400 || res.status === 404)
      throw new ImportUserError(`Couldn't read ${name}'s MyAnimeList. Check the username and that the list is public.`);
    if (!res.ok) throw new Error(`MyAnimeList returned ${res.status}`);
    const page = (await res.json()) as Json[];
    if (!Array.isArray(page)) throw new Error("MyAnimeList sent something unexpected");
    all.push(...page);
    if (page.length < 300) break;
  }
  return all;
}

export function parseMal(rows: Json[]): Parsed {
  const out = emptyParsed();
  for (const r of rows) {
    const at = isoFrom(numOr(r?.updated_at) ?? numOr(r?.created_at));
    const movie = String(r?.anime_media_type_string ?? "").toLowerCase() === "movie";
    const done = r?.status === MAL_STATUS.completed;
    const total = numOr(r?.anime_num_episodes) ?? 0;
    const count =
      done && !movie ? Math.max(numOr(r.num_watched_episodes) ?? 0, total) : (numOr(r?.num_watched_episodes) ?? 0);
    const type = String(r?.anime_media_type_string ?? "").toLowerCase();
    if (
      !r?.anime_id ||
      r.status === MAL_STATUS.planned ||
      type === "music" ||
      type === "pv" ||
      type === "cm" ||
      !at ||
      (movie ? !done : count <= 0)
    ) {
      out.skipped++;
      continue;
    }
    out.anime.push({
      ids: { mal: r.anime_id },
      title: r.anime_title_eng || r.anime_title || "",
      year: undefined,
      movie,
      episodes: movie ? [] : episodes(count, at),
      watchedAt: movie ? at : null,
    });
  }
  return out;
}
