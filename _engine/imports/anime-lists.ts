// MyAnimeList, read from a public profile by username (no sign-in, no key). MAL counts episodes
// watched per entry without per-episode dates, so every episode gets the entry's last update.
// Anime only; manga waits for comics (after v0.1). (An AniList import existed until 2026-10-06; it
// was dropped because AniList's API terms rule out use inside other tracker services.)
import { emptyParsed, ImportUserError, isoFrom, numOr, type Parsed } from "./types.ts";

// biome-ignore lint/suspicious/noExplicitAny: API responses are loosely typed JSON
type Json = any;

const episodes = (count: number, at: string) => Array.from({ length: count }, (_, i) => ({ number: i + 1, at }));

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
