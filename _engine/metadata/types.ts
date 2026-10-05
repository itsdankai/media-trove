export type MediaKind = "movie" | "show" | "audiobook";
export const mediaKinds = ["movie", "show", "audiobook"] as const;

export type SearchResult = {
  key: string;
  kind: MediaKind;
  title: string;
  year: number | null;
  poster: string | null;
  overview: string | null;
  subtitle?: string; // author for audiobooks
};

export type MediaInfo = SearchResult & {
  genres: string[];
  extra: Record<string, unknown>;
};

export type Season = { number: number; name: string; episodeCount: number; airDate: string | null };
export type Episode = { season: number; number: number; name: string; airDate: string | null; still: string | null };

export interface MetadataProvider {
  kinds: MediaKind[];
  search(kind: MediaKind, q: string): Promise<SearchResult[]>;
  details(key: string): Promise<MediaInfo>;
  season?(key: string, n: number): Promise<Episode[]>;
  /** Turns a plugin's description of a title (imdb id, asin, title…) into a media key, or null. */
  resolve?(ref: MediaRef): Promise<string | null>;
}

export type { MediaRef } from "../../plugins/_sdk/index.ts";

import type { MediaRef } from "../../plugins/_sdk/index.ts";

/** Loose title match: same words, ignoring case, punctuation and a leading "the". */
export function sameTitle(a: string, b: string) {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/^the /, "")
      .trim();
  return norm(a) === norm(b) || norm(a).startsWith(`${norm(b)} `) || norm(b).startsWith(`${norm(a)} `);
}

/** Thrown when a provider can't work yet (missing key) — the API turns it into a 503 with this message. */
export class ProviderUnavailable extends Error {}

export function makeKey(source: string, kind: MediaKind, id: string | number) {
  return `${source}-${kind}-${id}`;
}

export function parseKey(key: string) {
  const [source, kind, ...rest] = key.split("-");
  const id = rest.join("-");
  if (!source || !mediaKinds.includes(kind as MediaKind) || !id) throw new Error(`bad media key: ${key}`);
  return { source, kind: kind as MediaKind, id };
}

export function yearOf(date: string | null | undefined) {
  const y = Number(date?.slice(0, 4));
  return Number.isFinite(y) && y > 0 ? y : null;
}
