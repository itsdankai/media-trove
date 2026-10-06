// Simkl: the free API's /sync/all-items, or a SimklBackup.json (same shape; file backups are a paid
// Simkl feature). Sign-in uses Simkl's PIN flow, which needs only an app's client id (free to create
// at simkl.com/settings/developer); the token is used for this one import and not kept.
import type { MediaRef } from "../../plugins/_sdk/index.ts";
import { getJson } from "../../plugins/_sdk/index.ts";
import { baseName } from "./files.ts";
import { emptyParsed, ImportUserError, isoFrom, numOr, type Parsed, type UploadFile } from "./types.ts";

// biome-ignore lint/suspicious/noExplicitAny: Simkl responses are loosely typed JSON
type Json = any;

const API = "https://api.simkl.com";
const WATCHED = new Set(["completed", "watching", "hold", "dropped", "notinteresting"]);

export function parseSimklFiles(files: UploadFile[]): Parsed {
  const f = files.find((x) => baseName(x.name) === "simklbackup.json") ?? files.find((x) => x.name.endsWith(".json"));
  if (!f) throw new ImportUserError("Upload SimklBackup.json, or the ZIP that holds it.");
  try {
    return parseSimkl(JSON.parse(f.text));
  } catch (e) {
    if (e instanceof ImportUserError) throw e;
    throw new ImportUserError("That file isn't a Simkl backup.");
  }
}

const ids = (m: Json) => m?.ids ?? {};
const ref = (kind: "movie" | "show", m: Json): MediaRef => ({
  kind,
  tmdb: numOr(ids(m).tmdb),
  imdb: typeof ids(m).imdb === "string" && ids(m).imdb ? ids(m).imdb : undefined,
  tvdb: numOr(ids(m).tvdb),
  title: m?.title || undefined,
  year: numOr(m?.year),
});

const episodesOf = (entry: Json) =>
  (entry.seasons ?? []).flatMap((s: Json) =>
    (s?.episodes ?? []).map((ep: Json) => ({
      season: s.number,
      number: numOr(ep?.number),
      at: isoFrom(ep?.watched_at),
    })),
  ) as { season: number; number?: number; at: string | null }[];

export function parseSimkl(data: Json): Parsed {
  if (!data || typeof data !== "object") throw new ImportUserError("That file isn't a Simkl backup.");
  const out = emptyParsed();

  for (const e of data.movies ?? []) {
    const at = isoFrom(e?.last_watched_at);
    if (e?.status === "completed" && at)
      out.events.push({ media: ref("movie", e.movie), kind: "watched", occurredAt: at });
    else out.skipped++;
  }

  for (const e of data.shows ?? []) {
    const media = ref("show", e?.show);
    const eps = episodesOf(e ?? {});
    for (const ep of eps) {
      const at = ep.at ?? isoFrom(e.last_watched_at);
      if (at && ep.number && typeof ep.season === "number")
        out.events.push({ media, kind: "watched", season: ep.season, episode: ep.number, occurredAt: at });
      else out.skipped++;
    }
    if (!eps.length) out.skipped++;
  }

  // Simkl numbers anime episodes per entry, like AniList and MAL do; anime.ts maps them to TMDB.
  for (const e of data.anime ?? []) {
    const show = e?.show ?? {};
    const i = ids(show);
    const movie = String(e?.anime_type ?? "").toLowerCase() === "movie";
    if (!WATCHED.has(String(e?.status ?? ""))) {
      out.skipped++;
      continue;
    }
    out.anime.push({
      ids: {
        simkl: numOr(i.simkl),
        mal: numOr(i.mal),
        anidb: numOr(i.anidb),
        tmdb: numOr(i.tmdb),
        tvdb: numOr(i.tvdb),
      },
      title: show.title ?? "",
      year: numOr(show.year),
      movie,
      episodes: episodesOf(e)
        .filter((ep) => ep.number)
        .map((ep) => ({ number: ep.number as number, at: ep.at ?? isoFrom(e.last_watched_at) ?? "" }))
        .filter((ep) => ep.at),
      watchedAt: movie && e.status === "completed" ? isoFrom(e.last_watched_at) : null,
    });
  }
  return out;
}

// --- sign-in and download --------------------------------------------------------------------

export async function simklPin(clientId: string) {
  const r = await getJson<Json>(`${API}/oauth/pin?client_id=${encodeURIComponent(clientId)}`);
  if (!r?.user_code) throw new ImportUserError("Simkl didn't accept that client id.");
  return {
    userCode: String(r.user_code),
    url: String(r.verification_url ?? "https://simkl.com/pin"),
    expiresIn: Number(r.expires_in ?? 900),
    interval: Number(r.interval ?? 5),
  };
}

/** The access token once the user has entered the code at simkl.com/pin, or null while waiting. */
export async function simklPinToken(clientId: string, userCode: string): Promise<string | null> {
  const r = await getJson<Json>(
    `${API}/oauth/pin/${encodeURIComponent(userCode)}?client_id=${encodeURIComponent(clientId)}`,
  );
  return r?.access_token ? String(r.access_token) : null;
}

export async function simklDownload(clientId: string, token: string): Promise<Json> {
  return getJson(
    `${API}/sync/all-items/?extended=full&episode_watched_at=yes`,
    { headers: { "simkl-api-key": clientId, Authorization: `Bearer ${token}` } },
    120_000,
  );
}
