// One-time imports: history from a service's export file (Trakt, Simkl, Letterboxd, IMDb) or its
// public list (AniList, MyAnimeList). Each importer turns its input into plain events; runner.ts
// matches them to media keys and appends them under the source "import-<id>". Every event's time
// comes from the export itself, so running the same import twice stores nothing new.
import type { PluginEvent } from "../../plugins/_sdk/index.ts";

/**
 * A plugin-style event, or an episode known only by its own IMDb id (IMDb exports), or only by its title
 * (Netflix: episodeTitle, with season when known; fullTitle is tried as a movie if no episode matches).
 */
export type ImportEvent = PluginEvent & { episodeImdb?: string; episodeTitle?: string; fullTitle?: string };

/**
 * An anime list entry. Anime trackers count episodes per cour/season entry, not per TMDB season,
 * so these go through anime.ts, which maps them to TMDB with the community anime mapping lists.
 */
export type AnimeEntry = {
  ids: { anilist?: number; mal?: number; anidb?: number; simkl?: number; tmdb?: number; tvdb?: number };
  title: string;
  year?: number;
  movie: boolean;
  /** Episodes watched, numbered from 1 within this entry, each with when it was watched. */
  episodes: { number: number; at: string }[];
  /** Movies: when it was watched; null if the entry isn't finished. */
  watchedAt?: string | null;
};

export type Parsed = { events: ImportEvent[]; anime: AnimeEntry[]; skipped: number; notes: string[] };

export const emptyParsed = (): Parsed => ({ events: [], anime: [], skipped: 0, notes: [] });

/** A file from an upload; ZIPs are already unpacked (see files.ts). */
export type UploadFile = { name: string; text: string };

export class ImportUserError extends Error {}

/** A date-only value ("2024-10-25") lands at noon UTC, so it shows on the same day in every time zone. */
export function isoFrom(value: string | number | null | undefined): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  const s = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T12:00:00.000Z`;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export const numOr = (v: unknown) => {
  const n = typeof v === "number" ? v : Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
