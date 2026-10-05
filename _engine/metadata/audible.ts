// Audiobooks from Audible's public catalog API: no key, no login. It's undocumented
// (the same one Audiobookshelf's metadata search uses), so if it changes, only this file needs fixing.
import {
  type MediaInfo,
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
const groups = "contributors,media,product_attrs,product_desc,series,category_ladders";

// biome-ignore lint/suspicious/noExplicitAny: Audible responses are loosely typed JSON
type Json = any;

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
      if (ref.asin && /^[A-Z0-9]{10}$/i.test(ref.asin)) return makeKey("audible", "audiobook", ref.asin.toUpperCase());
      if (!ref.title) return null;
      const q = [ref.title, ref.author].filter(Boolean).join(" ");
      const data = await get("", { keywords: q, num_results: "10", products_sort_by: "Relevance" });
      const hit = (data.products as Json[]).find((p) => sameTitle(p.title, ref.title as string));
      return hit ? makeKey("audible", "audiobook", hit.asin) : null;
    },

    async details(key): Promise<MediaInfo> {
      const { id } = parseKey(key);
      const { product: p } = await get(`/${id}`, {});
      const series = (p.series as Json[] | undefined)?.[0];
      return {
        ...toResult(p),
        genres: [...new Set((p.category_ladders as Json[] | undefined)?.map((c) => c.ladder[0]?.name).filter(Boolean))],
        extra: {
          authors: names(p.authors),
          narrators: names(p.narrators),
          runtimeMin: p.runtime_length_min ?? null,
          series: series ? { name: series.title, position: series.sequence ?? null } : null,
          releaseDate: p.release_date ?? null,
        },
      };
    },
  };
}

const names = (people: Json[] | undefined): string[] => (people ?? []).map((x) => x.name);

function stripHtml(html: string | undefined | null) {
  if (!html) return null;
  return (
    html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim() || null
  );
}
