// Letterboxd and IMDb CSV exports.
import { baseName, parseCsv } from "./files.ts";
import { emptyParsed, ImportUserError, isoFrom, numOr, type Parsed, type UploadFile } from "./types.ts";

// --- Letterboxd (letterboxd.com/settings/data) -----------------------------------------------
// diary.csv has one row per logged viewing (rewatches included) with the date watched; watched.csv
// lists every film marked watched. Films in watched.csv with no diary entry come in once, dated
// when they were marked. No ids in the export, so films are matched by title and year.

export function parseLetterboxd(files: UploadFile[]): Parsed {
  const out = emptyParsed();
  const find = (n: string) => files.find((f) => baseName(f.name) === n);
  const diary = find("diary.csv");
  const watched = find("watched.csv");
  if (!diary && !watched)
    throw new ImportUserError("Upload the ZIP from letterboxd.com/settings/data, or its diary.csv or watched.csv.");

  const logged = new Set<string>();
  const film = (r: Record<string, string>) => ({ kind: "movie" as const, title: r.Name, year: numOr(r.Year) });
  const id = (r: Record<string, string>) => `${r.Name}|${r.Year}`;

  for (const r of diary ? parseCsv(diary.text) : []) {
    const at = isoFrom(r["Watched Date"]) ?? isoFrom(r.Date);
    if (!r.Name || !at) {
      out.skipped++;
      continue;
    }
    logged.add(id(r));
    out.events.push({ media: film(r), kind: "watched", occurredAt: at });
  }
  for (const r of watched ? parseCsv(watched.text) : []) {
    const at = isoFrom(r.Date);
    if (!r.Name || !at) out.skipped++;
    else if (!logged.has(id(r))) out.events.push({ media: film(r), kind: "watched", occurredAt: at });
  }
  return out;
}

// --- IMDb ------------------------------------------------------------------------------------
// ratings.csv (Your Ratings > Export): a rating means you watched it, dated when you rated it.
// Any other list export (check-ins, a "watched" list) counts as watched on the date it was added.
// Watchlists are things you haven't seen yet, so they're turned away. Rated whole series are
// skipped: a rating doesn't say which episodes you saw. Rated single episodes come in.

const MOVIE_TYPES = new Set(["movie", "tv movie", "short", "tv short", "video", "tv special"]);
const SERIES_TYPES = new Set(["tv series", "tv mini series", "tv mini-series", "tvseries", "tvminiseries"]);

export function parseImdb(files: UploadFile[]): Parsed {
  const out = emptyParsed();
  const csvs = files.filter((f) => f.name.toLowerCase().endsWith(".csv"));
  if (!csvs.length) throw new ImportUserError("Upload an IMDb CSV export, such as ratings.csv.");
  let used = 0;
  for (const f of csvs) {
    const rows = parseCsv(f.text);
    if (!rows.length || !("Const" in rows[0])) continue;
    const isRatings = "Your Rating" in rows[0];
    if (!isRatings && baseName(f.name).includes("watchlist")) {
      out.notes.push(`${baseName(f.name)} is a watchlist, so it was left out (watchlists aren't imported yet).`);
      continue;
    }
    used++;
    for (const r of rows) {
      const at = isoFrom(isRatings ? r["Date Rated"] : (r.Created ?? r["Date Added"]));
      const type = (r["Title Type"] ?? "").toLowerCase();
      const tt = r.Const;
      if (!at || !/^tt\d+$/.test(tt) || SERIES_TYPES.has(type)) {
        out.skipped++;
      } else if (type === "tv episode" || type === "episode") {
        out.events.push({ media: { kind: "show" }, episodeImdb: tt, kind: "watched", occurredAt: at });
      } else if (MOVIE_TYPES.has(type) || !type) {
        out.events.push({
          media: { kind: "movie", imdb: tt, title: r.Title, year: numOr(r.Year) },
          kind: "watched",
          occurredAt: at,
        });
      } else out.skipped++;
    }
  }
  if (!used && !out.notes.length) throw new ImportUserError("That doesn't look like an IMDb export (no Const column).");
  return out;
}
