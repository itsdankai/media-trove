// Simkl: the free API's /sync/all-items, or a SimklBackup.json (same shape; file backups are a paid
// Simkl feature). Sign-in is a device code entered at simkl.com/pin, which needs only an app's client
// id (free to create at simkl.com/settings/developer); the token is used for this one import and not
// kept. Apps made since Simkl's AUTH V2 (2026-09-18) use the standard OAuth 2.0 device flow; older apps
// still use the V1 PIN endpoints until Simkl retires them (around April 2027), so both are supported.
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

const UA = { "User-Agent": "MediaTrove/0.1 (self-hosted media tracker)" };

/** What the importer remembers between showing the code and the user approving it. */
export type SimklSignIn = { clientId: string; deviceCode: string | null };

async function form(path: string, fields: Record<string, string>) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(fields),
    signal: AbortSignal.timeout(15_000),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Json };
}

/** Starts sign-in: a code for the user to enter at simkl.com/pin. Read-only access is all we ask for. */
export async function simklPin(clientId: string) {
  const v2 = await form("/oauth2/device", { client_id: clientId, scope: "media:read" }).catch(() => null);
  let r = v2?.body?.device_code ? v2.body : null;
  if (!r) {
    // An app from before AUTH V2: the old PIN endpoint.
    r = await getJson<Json>(`${API}/oauth/pin?client_id=${encodeURIComponent(clientId)}`, { headers: UA }).catch(
      () => null,
    );
  }
  if (!r?.user_code)
    throw new ImportUserError("Simkl didn't accept that client ID. Copy it again from your Simkl app.");
  return {
    signIn: { clientId, deviceCode: r.device_code ? String(r.device_code) : null } as SimklSignIn,
    userCode: String(r.user_code),
    url: String(r.verification_uri ?? r.verification_url ?? "https://simkl.com/pin"),
    expiresIn: Number(r.expires_in ?? 900),
    interval: Number(r.interval ?? 5),
  };
}

/** The access token once the user has approved the code, or null while waiting. */
export async function simklPinToken(s: SimklSignIn, userCode: string): Promise<string | null> {
  if (s.deviceCode) {
    const r = await form("/oauth2/token", {
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: s.clientId,
      device_code: s.deviceCode,
    });
    if (r.body?.access_token) return String(r.body.access_token);
    const err = String(r.body?.error ?? "");
    if (err === "authorization_pending" || err === "slow_down") return null;
    if (err === "access_denied") throw new ImportUserError("Sign-in was declined on Simkl.");
    if (err === "expired_token") throw new ImportUserError("That code has expired. Start again.");
    throw new Error(`Simkl sign-in returned ${r.status}${err ? `: ${err}` : ""}`);
  }
  const r = await getJson<Json>(
    `${API}/oauth/pin/${encodeURIComponent(userCode)}?client_id=${encodeURIComponent(s.clientId)}`,
    { headers: UA },
  );
  return r?.access_token ? String(r.access_token) : null;
}

export async function simklDownload(clientId: string, token: string): Promise<Json> {
  return getJson(
    `${API}/sync/all-items/?extended=full&episode_watched_at=yes`,
    { headers: { ...UA, "simkl-api-key": clientId, Authorization: `Bearer ${token}` } },
    120_000,
  );
}
