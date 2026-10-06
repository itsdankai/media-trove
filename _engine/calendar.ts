// The release calendar: upcoming episodes of tracked shows that are still airing (TMDB), new movies in
// franchises you've watched (TMDB collections), and new audiobooks from the authors of tracked
// audiobooks (Audible pre-orders). Lookups are cached for a few hours; show details themselves are
// refreshed daily by library.refreshStale.
import { inArray } from "drizzle-orm";
import { type Db, events, type MediaRow, media } from "./db.ts";
import { eventsFor, project } from "./events.ts";
import type { Library } from "./library.ts";
import type { Episode } from "./metadata/types.ts";
import { getSettings } from "./settings.ts";

export type CalendarEntry = {
  date: string; // YYYY-MM-DD
  kind: "show" | "movie" | "audiobook";
  key: string; // the show's key, or the new movie's or book's key
  title: string;
  label: string; // "S2 · E5 · Episode name", "John Wick Collection", or "Red Rising · Pierce Brown"
  poster: string | null;
  tracked: boolean; // a show you watch; false: a new movie or book related to what you track
};

const TTL = 6 * 60 * 60 * 1000;
const PER_SHOW = 3;

export function createCalendar(db: Db, lib: Library) {
  const cache = new Map<string, { at: number; value: unknown }>();
  async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit.value as T;
    const value = await load();
    cache.set(key, { at: Date.now(), value });
    return value;
  }

  function tracked(kind: "show" | "movie" | "audiobook") {
    const keys = db
      .selectDistinct({ k: events.mediaKey })
      .from(events)
      .all()
      .map((r) => r.k);
    if (!keys.length) return [];
    return db
      .select()
      .from(media)
      .where(inArray(media.key, keys))
      .all()
      .filter((m) => m.kind === kind);
  }

  async function showEntries(from: string, to: string): Promise<CalendarEntry[]> {
    const threshold = getSettings(db).watchedThreshold;
    const airing = tracked("show").filter((m) => {
      const next = m.extra.nextEpisode as { season: number; airDate: string } | null | undefined;
      if (!next?.airDate || next.airDate > to) return false;
      // Only shows you've actually watched an episode of: sampling a few minutes of something
      // (a soap opera's single half-watched episode) doesn't put it on your calendar.
      return (project("show", eventsFor(db, m.key), undefined, threshold).watchedEpisodes?.length ?? 0) > 0;
    });
    const out: CalendarEntry[] = [];
    await Promise.all(
      airing.map(async (m: MediaRow) => {
        const next = m.extra.nextEpisode as { season: number; number: number; airDate: string };
        const eps = await cached<Episode[]>(
          `season:${m.key}:${next.season}`,
          () => lib.providerFor("show").season?.(m.key, next.season) ?? Promise.resolve([]),
        ).catch(() => [] as Episode[]);
        const list = eps.length
          ? eps
          : [{ season: next.season, number: next.number, name: "", airDate: next.airDate, still: null }];
        // The next few per show: a daily show would otherwise fill every day of the calendar.
        const soon = list
          .filter((e) => e.airDate && e.airDate >= from && e.airDate <= to)
          .sort((a, b) => (a.airDate as string).localeCompare(b.airDate as string))
          .slice(0, PER_SHOW);
        for (const e of soon) {
          if (!e.airDate) continue;
          out.push({
            date: e.airDate,
            kind: "show",
            key: m.key,
            title: m.title,
            label: [`S${e.season} · E${e.number}`, e.name].filter(Boolean).join(" · "),
            poster: m.poster,
            tracked: true,
          });
        }
      }),
    );
    return out;
  }

  async function bookEntries(from: string, to: string): Promise<CalendarEntry[]> {
    const books = tracked("audiobook");
    const have = new Set(books.flatMap((b) => b.key.replace(/^audible-audiobook-/, "").split("+")));
    const authors = new Map<string, string | null>(); // author -> language of the books tracked
    for (const b of books)
      for (const a of (b.extra.authors as string[] | undefined) ?? [])
        authors.set(a, (b.extra.language as string) ?? null);
    const provider = lib.providerFor("audiobook");
    if (!provider.upcoming) return [];
    const seen = new Set<string>();
    const out: CalendarEntry[] = [];
    for (const [author, language] of authors) {
      const list = await cached(`books:${author}:${language}`, () =>
        (provider.upcoming as NonNullable<typeof provider.upcoming>)(author, language),
      ).catch(() => []);
      for (const b of list) {
        const asin = b.key.replace(/^audible-audiobook-/, "");
        if (have.has(asin) || seen.has(b.key) || b.releaseDate < from || b.releaseDate > to) continue;
        seen.add(b.key);
        out.push({
          date: b.releaseDate,
          kind: "audiobook",
          key: b.key,
          title: b.title,
          label: [b.series, b.subtitle].filter(Boolean).join(" · "),
          poster: b.poster,
          tracked: false,
        });
      }
    }
    return out;
  }

  /** Upcoming films in the franchises of movies you've watched (the next John Wick, say). */
  async function movieEntries(from: string, to: string): Promise<CalendarEntry[]> {
    const movies = tracked("movie");
    const have = new Set(movies.map((m) => m.key));
    const collections = new Map<number, string>();
    for (const m of movies) {
      const c = m.extra.collection as { id: number; name: string } | null | undefined;
      if (c?.id) collections.set(c.id, c.name);
    }
    const provider = lib.providerFor("movie");
    if (!provider.collection) return [];
    const out: CalendarEntry[] = [];
    const ids = [...collections.keys()];
    for (let i = 0; i < ids.length; i += 4) {
      const found = await Promise.all(
        ids
          .slice(i, i + 4)
          .map((id) =>
            cached(`collection:${id}`, () =>
              (provider.collection as NonNullable<typeof provider.collection>)(id),
            ).catch(() => null),
          ),
      );
      for (const c of found) {
        for (const p of c?.parts ?? []) {
          if (!p.releaseDate || p.releaseDate < from || p.releaseDate > to || have.has(p.key)) continue;
          out.push({
            date: p.releaseDate,
            kind: "movie",
            key: p.key,
            title: p.title,
            label: c?.name ?? "",
            poster: p.poster,
            tracked: false,
          });
        }
      }
    }
    return out;
  }

  /** Everything coming out between today and `days` from now, soonest first. */
  async function upcoming(days: number, today = new Date()) {
    const from = today.toISOString().slice(0, 10);
    const to = new Date(today.getTime() + days * 86_400_000).toISOString().slice(0, 10);
    const [shows, movies, books] = await Promise.all([
      showEntries(from, to),
      movieEntries(from, to),
      bookEntries(from, to),
    ]);
    return [...shows, ...movies, ...books].sort(
      (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title),
    );
  }

  return { upcoming };
}

export type Calendar = ReturnType<typeof createCalendar>;
