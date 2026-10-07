// Audiobooks from Audible's public catalog API: no key, no login. It's undocumented
// (the same one Audiobookshelf's metadata search uses), so if it changes, only this file needs fixing.
//
// Editions matter: a GraphicAudio "dramatized adaptation" is a different recording from the
// single-narrator book, and Audible sells it split into parts ("Part 1 of 2"). People often
// keep those parts merged into one file, so a merged copy maps to a combined key holding every
// part's ASIN: audible-audiobook-B0CTWQ44B4+B0D5DKK1VS.
import {
  type MediaInfo,
  type MediaRef,
  type MetadataProvider,
  makeKey,
  parseKey,
  type SearchResult,
  sameTitle,
  yearOf,
} from "./types.ts";

const domains: Record<string, string> = {
  us: "audible.com",
  uk: "audible.co.uk",
  ca: "audible.ca",
  au: "audible.com.au",
  de: "audible.de",
  fr: "audible.fr",
  it: "audible.it",
  es: "audible.es",
  in: "audible.in",
  jp: "audible.co.jp",
};
const groups = "contributors,media,product_attrs,product_desc,series,category_ladders,rating";
/** Bumped when details gain fields; rows cached with an older version are fetched again (library.ts). */
export const META_VERSION = 3;

// biome-ignore lint/suspicious/noExplicitAny: Audible responses are loosely typed JSON
type Json = any;

const EDITION = /dramati[sz]ed|graphic\s*audio|full[- ]cast/i;
const PART = /\s*[([]\s*(?:part\s*)?(\d+)\s*of\s*(\d+)\s*[)\]]/i;

/** "Morning Star (Part 1 of 2) (Dramatized Adaptation)" → "Morning Star"; "Iron Gold: [Dramatized Adaptation]" → "Iron Gold". */
export function baseTitle(title: string) {
  return title
    .replace(/\s*[([][^)\]]*[)\]]/g, "")
    .replace(/[\s:–-]+$/, "")
    .trim();
}

/** "(Part 2 of 3)" or "(2 of 3)" → { n: 2, of: 3 } */
export function partOf(title: string) {
  const m = title.match(PART);
  return m ? { n: Number(m[1]), of: Number(m[2]) } : null;
}

const stripPart = (title: string) => title.replace(PART, "").trim();
const normTitle = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/^the /, "")
    .trim();
const editionHint = (ref: Pick<MediaRef, "title" | "publisher" | "narrator">) =>
  EDITION.test(`${ref.title ?? ""} ${ref.publisher ?? ""} ${ref.narrator ?? ""}`);
const isDramatized = (p: Json) => EDITION.test(`${p.title} ${p.subtitle ?? ""} ${p.publisher_name ?? ""}`);

/**
 * Picks the Audible product(s) for a book: same base title and same edition (dramatized or not).
 * Returns ASINs: one for a normal book or a named part, every part (in order) for a merged copy.
 */
export function pickEdition(
  ref: Pick<MediaRef, "title" | "publisher" | "narrator" | "year">,
  products: Json[],
): string[] {
  if (!ref.title) return [];
  const base = baseTitle(ref.title);
  // Exact title first ("Red Rising: Sons of Ares" is a different book from "Red Rising"). Libraries
  // often fold the series into the title ("Match Game: Expeditionary Force, Book 14"), so each
  // piece split at ":" or " - " counts as exact too. Loose matching is the last resort.
  const names = new Set([base, ...base.split(/\s*:\s+|\s+[-–]\s+/)].map(normTitle).filter((s) => s.length > 2));
  const exact = products.filter((p) => p.title && names.has(normTitle(baseTitle(p.title))));
  const same = exact.length ? exact : products.filter((p) => p.title && sameTitle(baseTitle(p.title), base));
  let wantDramatized = editionHint(ref);
  // No edition clue in the title, publisher or narrator: the release year can still tell them apart
  // (a 2023 "Red Rising" is the GraphicAudio one; the narrated book is from 2014).
  if (!wantDramatized && ref.year) {
    const sameYear = same.filter((p) => yearOf(p.release_date) === ref.year);
    if (sameYear.length && sameYear.every(isDramatized)) wantDramatized = true;
  }
  const edition = same.filter((p) => isDramatized(p) === wantDramatized);
  const picks = edition.length ? edition : wantDramatized ? [] : same;
  if (!picks.length) return [];

  const wantPart = partOf(ref.title);
  const parts = picks.map((p) => ({ p, part: partOf(p.title) })).filter((x) => x.part);
  if (wantPart) {
    const hit = parts.find((x) => x.part?.n === wantPart.n);
    return hit ? [hit.p.asin] : [];
  }
  const whole = picks.find((p) => !partOf(p.title));
  if (whole) return [whole.asin];
  // Only parts exist: the copy is the merged edition. Use every part we found, in order.
  const byN = new Map<number, string>();
  for (const { p, part } of parts.sort((a, b) => (a.part?.n ?? 0) - (b.part?.n ?? 0))) {
    if (part && !byN.has(part.n)) byN.set(part.n, p.asin);
  }
  return [...byN.values()];
}

export function audibleProvider(
  region = process.env.AUDIBLE_REGION ?? "us",
  fetchFn: typeof fetch = fetch,
): MetadataProvider {
  const api = `https://api.${domains[region] ?? domains.us}/1.0/catalog/products`;

  async function get(path: string, params: Record<string, string>): Promise<Json> {
    const qs = new URLSearchParams({ ...params, response_groups: groups, image_sizes: "500" });
    const res = await fetchFn(`${api}${path}?${qs}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Audible catalog returned ${res.status}`);
    return res.json();
  }

  const toResult = (p: Json): SearchResult => ({
    key: makeKey("audible", "audiobook", p.asin),
    kind: "audiobook",
    title: p.title,
    year: yearOf(p.release_date),
    poster: p.product_images?.["500"] ?? null,
    overview: stripHtml(p.merchandising_summary ?? p.publisher_summary),
    subtitle: names(p.authors).join(", ") || undefined,
  });

  async function product(asin: string): Promise<MediaInfo> {
    const { product: p } = await get(`/${asin}`, {});
    const series = (p.series as Json[] | undefined)?.[0];
    return {
      ...toResult(p),
      // Audible's categories nest: "Science Fiction & Fantasy > Science Fiction > Space Opera". The middle
      // level makes useful genres (the top one is too broad); the deepest level becomes tags.
      genres: ladderNames(p, 1),
      extra: {
        tags: ladderNames(p, 2),
        authors: names(p.authors),
        narrators: names(p.narrators),
        publisher: p.publisher_name ?? null,
        runtimeMin: p.runtime_length_min ?? null,
        series: series ? { name: series.title, position: series.sequence ?? null } : null,
        releaseDate: p.release_date ?? null,
        language: p.language ?? null,
        rating: Number(p.rating?.overall_distribution?.display_average_rating) || null, // out of 5
        metaVersion: META_VERSION,
      },
    };
  }

  return {
    kinds: ["audiobook"],

    async search(_kind, q) {
      const data = await get("", { keywords: q, num_results: "20", products_sort_by: "Relevance" });
      return (data.products as Json[])
        .filter((p) => !String(p.content_delivery_type).includes("Podcast"))
        .map(toResult);
    },

    async resolve(ref) {
      if (ref.kind !== "audiobook") return null;
      const asinKey =
        ref.asin && /^[A-Z0-9]{10}$/i.test(ref.asin) ? makeKey("audible", "audiobook", ref.asin.toUpperCase()) : null;
      if (asinKey && !ref.title) return asinKey;
      if (asinKey) {
        // Trust the library's ASIN only when it agrees with the copy (builder's ABS, 2026-10-07): ABS's own
        // match often picks "Part 1 of 2" for a merged GraphicAudio file, or the narrated edition for a
        // dramatized one. On any disagreement, match by title instead, which handles both.
        const p = (await get(`/${ref.asin?.toUpperCase()}`, {}).catch(() => null))?.product;
        const py = p ? yearOf(p.release_date) : null;
        const disagrees =
          p?.title &&
          ((editionHint(ref) && !isDramatized(p)) ||
            (partOf(p.title) && !partOf(ref.title as string)) ||
            (ref.year && py && Math.abs(ref.year - py) > 1));
        if (!disagrees) return asinKey;
      }
      if (!ref.title) return null;
      const search = async (extra: string) => {
        const q = [baseTitle(ref.title as string), ref.author, extra].filter(Boolean).join(" ");
        return (await get("", { keywords: q, num_results: "20", products_sort_by: "Relevance" })).products as Json[];
      };
      // Without an edition clue, also look for dramatizations so the year check has both to compare.
      let products = await search(editionHint(ref) ? "dramatized adaptation" : "");
      if (!editionHint(ref) && ref.year) {
        const seen = new Set(products.map((p) => p.asin));
        products = [...products, ...(await search("dramatized adaptation")).filter((p) => !seen.has(p.asin))];
      }
      const asins = pickEdition(ref, products);
      return asins.length ? makeKey("audible", "audiobook", asins.join("+")) : asinKey;
    },

    /** Books by an author not out yet (Audible lists pre-orders with their release date), in one language. */
    async upcoming(author, language) {
      const today = new Date().toISOString().slice(0, 10);
      const data = await get("", { author, products_sort_by: "-ReleaseDate", num_results: "20" });
      return (data.products as Json[])
        .filter((p) => p.release_date && p.release_date > today)
        .filter((p) => !language || !p.language || p.language === language)
        .map((p) => ({
          ...toResult(p),
          releaseDate: p.release_date as string,
          series: (p.series as Json[])?.[0]?.title ?? null,
        }));
    },

    async details(key): Promise<MediaInfo> {
      const asins = parseKey(key).id.split("+");
      if (asins.length === 1) return product(asins[0]);
      // A merged copy: one book built from all its parts.
      const parts = await Promise.all(asins.map(product));
      const first = parts[0];
      const sum = parts.reduce((n, p) => n + ((p.extra.runtimeMin as number) ?? 0), 0);
      return {
        ...first,
        key,
        title: stripPart(first.title),
        genres: [...new Set(parts.flatMap((p) => p.genres))],
        extra: {
          ...first.extra,
          narrators: [...new Set(parts.flatMap((p) => p.extra.narrators as string[]))],
          tags: [...new Set(parts.flatMap((p) => (p.extra.tags as string[]) ?? []))],
          runtimeMin: sum || null,
          parts: parts.length,
        },
      };
    },
  };
}

const names = (people: Json[] | undefined): string[] => (people ?? []).map((x) => x.name);

/** Category names at one depth of Audible's ladders (falling back to the deepest level a ladder has). */
function ladderNames(p: Json, depth: number): string[] {
  const out = new Set<string>();
  for (const c of (p.category_ladders as Json[] | undefined) ?? []) {
    const ladder = c.ladder as Json[];
    const name = (ladder[depth] ?? (depth === 1 ? ladder.at(-1) : undefined))?.name;
    if (name) out.add(name);
  }
  return [...out];
}

function stripHtml(html: string | undefined | null) {
  if (!html) return null;
  return (
    html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim() || null
  );
}
