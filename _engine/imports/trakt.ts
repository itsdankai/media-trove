// Trakt's free data export (trakt.tv/settings/data): a ZIP of JSON files. Watch history is one entry
// per play (watched-history-1.json, -2.json…), so rewatches come in with their own dates. If a ZIP has
// no history files, the per-title "watched" files are used instead (last play only).
// Since mid-2026 Trakt API keys need VIP, so the export file is the way in for everyone.
import type { MediaRef } from "../../plugins/_sdk/index.ts";
import { baseName } from "./files.ts";
import {
  emptyParsed,
  type ImportEvent,
  ImportUserError,
  isoFrom,
  numOr,
  type Parsed,
  type UploadFile,
} from "./types.ts";

// biome-ignore lint/suspicious/noExplicitAny: export files are loosely typed JSON
type Json = any;

const ref = (kind: "movie" | "show", m: Json): MediaRef => ({
  kind,
  tmdb: numOr(m?.ids?.tmdb),
  imdb: typeof m?.ids?.imdb === "string" && m.ids.imdb ? m.ids.imdb : undefined,
  tvdb: numOr(m?.ids?.tvdb),
  title: m?.title || undefined,
  year: numOr(m?.year),
});

function readJson(f: UploadFile): Json[] {
  try {
    const data = JSON.parse(f.text);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function parseTrakt(files: UploadFile[]): Parsed {
  const out = emptyParsed();
  const history = files.filter((f) => /^(watched-)?history.*\.json$/.test(baseName(f.name)));
  for (const f of history) for (const e of readJson(f)) addPlay(out, e);

  if (!history.length) {
    const watched = files.filter((f) => /^watched-(movies|shows).*\.json$/.test(baseName(f.name)));
    for (const f of watched) for (const e of readJson(f)) addWatched(out, e);
    if (!watched.length) {
      throw new ImportUserError(
        "No watch history found. Upload the ZIP from trakt.tv/settings/data (it has watched-history files).",
      );
    }
    out.notes.push("This export had no play-by-play history, so only the last watch of each title came in.");
  }
  return out;
}

/** One play: the export's history entries, or the flat format Trakt's own importer takes. */
function addPlay(out: Parsed, e: Json) {
  const at = isoFrom(e?.watched_at);
  if (!at) return void out.skipped++;
  let ev: ImportEvent | null = null;
  if (e.movie || e.type === "movie") {
    ev = {
      media: e.movie ? ref("movie", e.movie) : { kind: "movie", imdb: e.imdb_id },
      kind: "watched",
      occurredAt: at,
    };
  } else if (e.episode && e.show) {
    const season = numOr(e.episode.season) ?? (e.episode.season === 0 ? 0 : undefined);
    const episode = numOr(e.episode.number);
    if (season !== undefined && episode)
      ev = { media: ref("show", e.show), kind: "watched", season, episode, occurredAt: at };
  } else if (e.type === "episode" && e.imdb_id) {
    ev = { media: { kind: "show" }, episodeImdb: e.imdb_id, kind: "watched", occurredAt: at };
  }
  if (ev && (ev.media.tmdb || ev.media.imdb || ev.media.tvdb || ev.media.title || ev.episodeImdb)) out.events.push(ev);
  else out.skipped++;
}

/** A watched-movies / watched-shows entry: last play of each movie and episode. */
function addWatched(out: Parsed, e: Json) {
  if (e?.movie) {
    const at = isoFrom(e.last_watched_at);
    if (at) out.events.push({ media: ref("movie", e.movie), kind: "watched", occurredAt: at });
    else out.skipped++;
    return;
  }
  if (!e?.show || !Array.isArray(e.seasons)) return void out.skipped++;
  const media = ref("show", e.show);
  for (const s of e.seasons) {
    for (const ep of s?.episodes ?? []) {
      const at = isoFrom(ep?.last_watched_at) ?? isoFrom(e.last_watched_at);
      const episode = numOr(ep?.number);
      if (at && episode && typeof s.number === "number")
        out.events.push({ media, kind: "watched", season: s.number, episode, occurredAt: at });
      else out.skipped++;
    }
  }
}
