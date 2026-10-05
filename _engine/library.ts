// Media lookups shared by the API and the sync engine: which provider handles a kind, caching
// metadata rows, and matching a plugin's MediaRef to a media key (cached in id_map).
import { eq } from "drizzle-orm";
import { type Db, idMap, media } from "./db.ts";
import {
  type MediaInfo,
  type MediaKind,
  type MediaRef,
  type MetadataProvider,
  ProviderUnavailable,
  parseKey,
} from "./metadata/types.ts";

const RETRY_MISS_MS = 24 * 60 * 60 * 1000;

export function createLibrary(db: Db, providers: MetadataProvider[]) {
  const providerFor = (kind: MediaKind) => {
    const p = providers.find((x) => x.kinds.includes(kind));
    if (!p) throw new ProviderUnavailable(`No metadata source for ${kind}`);
    return p;
  };

  function upsertMedia(info: MediaInfo) {
    const row = {
      key: info.key,
      kind: info.kind,
      title: info.title,
      year: info.year,
      poster: info.poster,
      overview: info.overview,
      genres: info.genres,
      extra: { ...info.extra, subtitle: info.subtitle ?? null },
      updatedAt: Date.now(),
    };
    db.insert(media).values(row).onConflictDoUpdate({ target: media.key, set: row }).run();
    return row;
  }

  async function ensureMedia(key: string) {
    const cached = db.select().from(media).where(eq(media.key, key)).get();
    if (cached) return cached;
    return upsertMedia(await providerFor(parseKey(key).kind).details(key));
  }

  /** The most specific id wins; title matching is the last resort. */
  function refKey(r: MediaRef) {
    const id = r.tmdb
      ? `tmdb:${r.tmdb}`
      : r.imdb
        ? `imdb:${r.imdb}`
        : r.tvdb
          ? `tvdb:${r.tvdb}`
          : r.asin
            ? `asin:${r.asin}`
            : null;
    return `${r.kind}:${id ?? `title:${(r.title ?? "").toLowerCase()}|${(r.author ?? "").toLowerCase()}|${r.year ?? ""}`}`;
  }

  async function resolve(r: MediaRef): Promise<string | null> {
    const ref = refKey(r);
    const hit = db.select().from(idMap).where(eq(idMap.ref, ref)).get();
    if (hit && (hit.mediaKey || Date.now() - hit.checkedAt < RETRY_MISS_MS)) return hit.mediaKey;
    const p = providerFor(r.kind);
    let key = p.resolve ? await p.resolve(r) : null;
    // An ASIN not sold in this Audible region: fall back to the title.
    if (!key && r.asin && r.title && p.resolve) key = await p.resolve({ ...r, asin: undefined });
    if (key) await ensureMedia(key);
    const row = { ref, mediaKey: key, checkedAt: Date.now() };
    db.insert(idMap).values(row).onConflictDoUpdate({ target: idMap.ref, set: row }).run();
    return key;
  }

  return { providerFor, upsertMedia, ensureMedia, resolve };
}

export type Library = ReturnType<typeof createLibrary>;
