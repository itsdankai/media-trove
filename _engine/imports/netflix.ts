// Netflix viewing history. Netflix has no API, so this reads one of its two downloads:
//   - Viewing activity → "Download all" (NetflixViewingHistory.csv): one profile, columns Title, Date.
//   - Account → "Get my info" (a ZIP, works after cancelling too): CONTENT_INTERACTION/ViewingActivity.csv,
//     every profile, with Profile Name, Start Time (UTC), Duration, Supplemental Video Type…
// Titles name episodes, not numbers: "Stranger Things: Season 4: Chapter Seven". The show and season are
// split off here; the runner finds the show on TMDB and the episode by its title (runner.ts matchOne).
// Netflix lists anything played, so from the data request, trailers and plays under 5 minutes are skipped.
import { baseName, parseCsv } from "./files.ts";
import { emptyParsed, type ImportEvent, ImportUserError, type Parsed, type UploadFile } from "./types.ts";

const MIN_PLAY_SECONDS = 5 * 60;

/** The part of a title that says which season: "Season 2", "Limited Series", "Part 3", "Volume 1"… */
const SEASON =
  /^(?:(season|series|part|volume|vol\.|collection|book|chapter)\s+(\d+)|(limited series|miniseries|mini-series))$/i;

export type NetflixTitle =
  | { kind: "movie"; title: string }
  | { kind: "episode"; show: string; season: number | null; episode: string; full: string };

/** "Show: Season 1: Episode" → episode of season 1; "Show: Episode" → episode, season unknown; else a movie. */
export function splitTitle(raw: string): NetflixTitle {
  const parts = raw.split(": ").map((p) => p.trim());
  const i = parts.findIndex((p, n) => n > 0 && SEASON.test(p));
  if (i > 0 && i < parts.length - 1) {
    const m = parts[i].match(SEASON) as RegExpMatchArray;
    return {
      kind: "episode",
      show: parts.slice(0, i).join(": "),
      season: m[2] ? Number(m[2]) : 1, // "Limited Series" is a single season
      episode: parts.slice(i + 1).join(": "),
      full: raw,
    };
  }
  // Some shows name the season after themselves: "Stranger Things: Stranger Things 4: Chapter One".
  const own = parts.length >= 3 ? parts[1].match(/^(.+?)\s+(\d+)$/) : null;
  if (own && own[1].toLowerCase() === parts[0].toLowerCase())
    return { kind: "episode", show: parts[0], season: Number(own[2]), episode: parts.slice(2).join(": "), full: raw };
  // No season marker: "Show: Episode" or a movie with a colon ("Glass Onion: A Knives Out Mystery").
  // The runner tries it as an episode first, then as a movie by the full title.
  if (parts.length >= 2)
    return { kind: "episode", show: parts[0], season: null, episode: parts.slice(1).join(": "), full: raw };
  return { kind: "movie", title: raw };
}

/** "1:02:03" or "0:42:13" → seconds. */
const seconds = (d: string) => d.split(":").reduce((n, p) => n * 60 + (Number(p) || 0), 0);

/**
 * Netflix's simple export writes dates in the account's locale: 10/5/26 or 5/10/2026. Read them all
 * first: if any first number is over 12 the file is day-first, if any second number is, month-first;
 * otherwise month-first (US). Dates land at noon UTC so they show on the same day everywhere.
 */
export function dateReader(values: string[]) {
  const parts = values.map((v) => v.split(/[/.-]/).map(Number)).filter((p) => p.length === 3);
  const dayFirst = parts.some((p) => p[0] > 12) && !parts.some((p) => p[1] > 12);
  return (v: string) => {
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return `${v.slice(0, 10)}T12:00:00.000Z`;
    const p = v.split(/[/.-]/).map(Number);
    if (p.length !== 3 || p.some(Number.isNaN)) return null;
    const [a, b, y] = p;
    const [month, day] = dayFirst ? [b, a] : [a, b];
    const year = y < 100 ? 2000 + y : y;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T12:00:00.000Z`;
  };
}

function eventFor(title: string, at: string): ImportEvent {
  const t = splitTitle(title);
  if (t.kind === "movie") return { media: { kind: "movie", title: t.title }, kind: "watched", occurredAt: at };
  return {
    media: { kind: "show", title: t.show },
    kind: "watched",
    occurredAt: at,
    episodeTitle: t.episode,
    ...(t.season != null ? { season: t.season } : {}),
    fullTitle: t.full,
  };
}

export function parseNetflix(files: UploadFile[], opts: { profile?: string } = {}): Parsed {
  const out = emptyParsed();
  const detailed = files.find((f) => baseName(f.name) === "viewingactivity.csv");
  if (detailed) {
    const rows = parseCsv(detailed.text);
    const profiles = [...new Set(rows.map((r) => r["Profile Name"]).filter(Boolean))];
    const want = opts.profile?.trim();
    if (profiles.length > 1 && !want)
      throw new ImportUserError(
        `This file has ${profiles.length} profiles (${profiles.join(", ")}). Enter yours in "Profile".`,
      );
    const match = want ? profiles.find((p) => p.toLowerCase() === want.toLowerCase()) : profiles[0];
    if (want && !match)
      throw new ImportUserError(`No profile called "${want}". This file has: ${profiles.join(", ")}.`);
    for (const r of rows) {
      if (r["Profile Name"] !== match) continue;
      // "2026-10-05 21:14:03", in UTC.
      const start = r["Start Time"] ?? "";
      const at = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(start) ? `${start.replace(" ", "T")}Z` : null;
      // Trailers, hooks and previews, and anything played under 5 minutes, aren't viewings.
      if (!at || r["Supplemental Video Type"] || seconds(r.Duration ?? "0") < MIN_PLAY_SECONDS || !r.Title) {
        out.skipped++;
        continue;
      }
      out.events.push(eventFor(r.Title, new Date(at).toISOString()));
    }
    out.notes.push(`Profile: ${match}. Trailers and plays under 5 minutes were left out.`);
    return out;
  }

  const simple =
    files.find((f) => /netflix.*\.csv$|viewinghistory.*\.csv$/i.test(baseName(f.name))) ??
    files.find((f) => f.name.toLowerCase().endsWith(".csv"));
  if (!simple) throw new ImportUserError('Upload NetflixViewingHistory.csv, or the ZIP from Netflix\'s "Get my info".');
  const rows = parseCsv(simple.text);
  if (!rows.length || !("Title" in rows[0]) || !("Date" in rows[0]))
    throw new ImportUserError("That doesn't look like a Netflix viewing history (no Title and Date columns).");
  const read = dateReader(rows.map((r) => r.Date));
  for (const r of rows) {
    const at = read(r.Date ?? "");
    if (!at || !r.Title) out.skipped++;
    else out.events.push(eventFor(r.Title, at));
  }
  return out;
}
