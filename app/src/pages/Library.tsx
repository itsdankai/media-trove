import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { PosterCard, PosterGrid } from "@/components/PosterCard";
import { menuFor } from "@/components/PosterMenu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  api,
  completion,
  kindLabel,
  type Media,
  type MediaKind,
  type Section,
  statusLabel,
  type TrackState,
} from "@/lib/api";

const statuses: Record<Section, TrackState["status"][]> = {
  movie: ["watching", "completed"],
  show: ["watching", "caught_up", "completed"],
  anime: ["watching", "caught_up", "completed"],
  audiobook: ["listening", "finished"],
};

const title: Record<Section, string> = { ...kindLabel, anime: "Anime" };

/** Minimum ratings that can be offered: out of 10 (TMDB; for anime, the community score), Audible out of 5. */
const ratingSteps = (section: Section) => (section === "audiobook" ? [3.5, 4, 4.5] : [6, 7, 8, 9]);
/** Sort options per section. "recent" (last activity) is the default; audiobooks add author and length, movies add runtime. */
type SortKey = "recent" | "az" | "za" | "year" | "rating" | "author" | "shortest" | "longest";
const sortLabel: Record<SortKey, string> = {
  recent: "Most recent",
  az: "Title A–Z",
  za: "Title Z–A",
  year: "Newest release",
  rating: "Highest rated",
  author: "Author A–Z",
  shortest: "Shortest",
  longest: "Longest",
};
const sortOptions: Record<Section, SortKey[]> = {
  movie: ["recent", "az", "za", "year", "rating", "shortest", "longest"],
  show: ["recent", "az", "za", "year", "rating"],
  anime: ["recent", "az", "za", "year", "rating"],
  audiobook: ["recent", "az", "za", "author", "shortest", "longest", "year", "rating"],
};
type Item = { media: { title: string; year: number | null; extra: Media["extra"] }; state: TrackState };
/** "The Matrix" sorts under M. */
const sortTitle = (t: string) => t.replace(/^(the|a|an)\s+/i, "");
const length = (i: Item) => i.media.extra.runtimeMin ?? i.media.extra.runtime ?? null;
/** The full release date where known, else the year (sorts the same way as a string). */
const released = (i: Item) => i.media.extra.releaseDate ?? (i.media.year ? String(i.media.year) : null);
/**
 * The rating weighed by how many people gave it, so a 9.1 from a few hundred early fans doesn't beat an 8.5
 * from 38,000: (votes × rating + m × typical) ÷ (votes + m). The anime community score has no count: as is.
 */
export function weighted(extra: Media["extra"]): number | null {
  const r = extra.rating;
  if (r == null) return null;
  const audible = extra.ratingCount != null;
  const n = audible ? extra.ratingCount : extra.ratingSource === "anime community" ? null : extra.voteCount;
  if (n == null) return r;
  const [m, typical] = audible ? [100, 4.3] : [1000, 6.5];
  return (n * r + m * typical) / (n + m);
}
/** Compares two items; titles break ties, and missing values always go last. */
function compare(key: SortKey, a: Item, b: Item): number {
  const byTitle = sortTitle(a.media.title).localeCompare(sortTitle(b.media.title), undefined, { numeric: true });
  const last = (x: number | string | null | undefined, y: number | string | null | undefined, desc: boolean) => {
    if (x == null || x === "") return y == null || y === "" ? byTitle : 1;
    if (y == null || y === "") return -1;
    const d = typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number);
    return (desc ? -d : d) || byTitle;
  };
  switch (key) {
    case "az":
      return byTitle;
    case "za":
      return -byTitle;
    case "year":
      return last(released(a), released(b), true);
    case "rating":
      return last(weighted(a.media.extra), weighted(b.media.extra), true);
    case "author":
      return last(a.media.extra.authors?.[0], b.media.extra.authors?.[0], false);
    case "shortest":
      return last(length(a), length(b), false);
    case "longest":
      return last(length(a), length(b), true);
    default:
      return last(a.state.lastActivityAt, b.state.lastActivityAt, true);
  }
}

const ratingSource: Record<Section, string> = {
  movie: "on TMDB",
  show: "on TMDB",
  anime: "community score",
  audiobook: "stars",
};

export function Library({ section }: { section: Section }) {
  // Filters live in the URL (?status=watching&genre=Drama…) so Back from an item returns to the same view.
  const [params, setParams] = useSearchParams();
  const f = {
    status: params.get("status") ?? "all",
    type: params.get("type") ?? "all", // anime only: show | movie
    genre: params.get("genre") ?? "",
    decade: params.get("decade") ?? "",
    rating: params.get("rating") ?? "",
    tag: params.get("tag") ?? "", // anime and audiobooks: Isekai, Shounen… / Space Opera, LitRPG…
    sort: params.get("sort") ?? "", // empty = most recent
  };
  const sort: SortKey = sortOptions[section].includes(f.sort as SortKey) ? (f.sort as SortKey) : "recent";
  const set = (key: keyof typeof f, value: string) => {
    const next = new URLSearchParams(params);
    if (!value || value === "all") next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };
  const { data, isLoading } = useQuery({ queryKey: ["library", section], queryFn: () => api.library(section) });
  // Titles only saved for later live on the Watchlist page, not here.
  const all = (data ?? []).filter((i) => i.state.status !== "planned");

  // Options come from what's actually in this section.
  const genres = [...new Set(all.flatMap((i) => i.media.genres))].sort();
  const decades = [
    ...new Set(
      all
        .map((i) => i.media.year)
        .filter(Boolean)
        .map((y) => Math.floor((y as number) / 10) * 10),
    ),
  ].sort((a, b) => b - a);
  // Tags A to Z, each with how many titles here have it.
  const tagCounts = new Map<string, number>();
  for (const i of all) for (const t of i.media.extra.tags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  const tags = [...tagCounts.keys()].sort((a, b) => a.localeCompare(b));
  // Only minimums that at least one title here reaches.
  const ratings = ratingSteps(section).filter((r) => all.some((i) => (i.media.extra.rating ?? 0) >= r));

  const items = all
    .filter(
      ({ media, state }) =>
        (f.status === "all" || state.status === f.status) &&
        (f.type === "all" || media.kind === f.type) &&
        (!f.genre || media.genres.includes(f.genre)) &&
        (!f.decade || (media.year != null && Math.floor(media.year / 10) * 10 === Number(f.decade))) &&
        (!f.rating || (media.extra.rating ?? 0) >= Number(f.rating)) &&
        (!f.tag || (media.extra.tags ?? []).includes(f.tag)),
    )
    .sort((a, b) => compare(sort, a, b));
  const filtered = Boolean(f.genre || f.decade || f.rating || f.tag || f.type !== "all" || f.status !== "all");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title[section]}</h1>
          <p className="text-sm text-muted-foreground">
            {data ? (filtered ? `${items.length} of ${all.length} tracked` : `${all.length} tracked`) : " "}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {section === "anime" && (
            <Tabs value={f.type} onValueChange={(v) => set("type", v)}>
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="show">Shows</TabsTrigger>
                <TabsTrigger value="movie">Movies</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          <Tabs value={f.status} onValueChange={(v) => set("status", v)}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              {statuses[section].map((s) => (
                <TabsTrigger key={s} value={s}>
                  {statusLabel[s]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </div>

      {all.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Filter label="Genre" value={f.genre} onChange={(v) => set("genre", v)}>
            {genres.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </Filter>
          <Filter label="Year" value={f.decade} onChange={(v) => set("decade", v)}>
            {decades.map((d) => (
              <option key={d} value={d}>
                {d}s
              </option>
            ))}
          </Filter>
          {ratings.length > 0 && (
            <Filter label="Rating" value={f.rating} onChange={(v) => set("rating", v)}>
              {ratings.map((r) => (
                <option key={r} value={r}>
                  {r}+ {ratingSource[section]}
                </option>
              ))}
            </Filter>
          )}
          {tags.length > 0 && (
            <Filter label="Tag" value={f.tag} onChange={(v) => set("tag", v)}>
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t} ({tagCounts.get(t)})
                </option>
              ))}
            </Filter>
          )}
          <label className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm sm:ml-auto">
            <span className="text-muted-foreground">Sort</span>
            <select
              value={sort}
              onChange={(e) => set("sort", e.target.value === "recent" ? "" : e.target.value)}
              className="bg-transparent font-medium outline-none [&>option]:bg-card"
              aria-label="Sort"
            >
              {sortOptions[section].map((k) => (
                <option key={k} value={k}>
                  {sortLabel[k]}
                </option>
              ))}
            </select>
          </label>
          {filtered && (
            <button
              type="button"
              onClick={() => setParams(f.sort ? { sort: f.sort } : {}, { replace: true })}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" /> Clear
            </button>
          )}
        </div>
      )}

      {!isLoading && all.length === 0 && (
        <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          Nothing here yet. Use the search bar to find something, then track it.{" "}
          <Link to="/search" className="text-primary underline-offset-4 hover:underline">
            Search
          </Link>
        </div>
      )}
      {!isLoading && all.length > 0 && items.length === 0 && (
        <p className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          Nothing matches these filters.
        </p>
      )}

      <PosterGrid>
        {items.map((item) => {
          const { media, state, favoritedAt } = item;
          return (
            <PosterCard
              key={media.key}
              to={`/media/${media.key}`}
              kind={media.kind}
              title={media.title}
              poster={media.poster}
              rated={{ mediaKey: media.key, anime: media.extra.anime, score: media.extra.rating }}
              sub={subline(media.kind, state, media.extra.subtitle ?? null, media.year)}
              progress={completion(media, state)}
              starred={favoritedAt != null}
              menu={menuFor(item)}
              badge={
                state.status === "completed" || state.status === "finished" ? undefined : statusLabel[state.status]
              }
            />
          );
        })}
      </PosterGrid>
    </div>
  );
}

/** A compact native select: "Genre: Any". */
function Filter({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent font-medium outline-none [&>option]:bg-card"
        aria-label={label}
      >
        <option value="">Any</option>
        {children}
      </select>
    </label>
  );
}

/** The line under a poster. The year is always there; what's added depends on the kind. */
function subline(kind: MediaKind, s: TrackState, subtitle: string | null, year: number | null) {
  const parts: (string | number | null)[] = [year];
  if (kind === "show") {
    const n = s.watchedEpisodes?.length ?? 0;
    parts.push(`${n} ${n === 1 ? "episode" : "episodes"}`);
  } else if (kind === "audiobook") {
    if (s.status === "listening") parts.unshift(`${Math.round((s.progress ?? 0) * 100)}%`);
    parts.push(subtitle);
  } else if (s.watchCount && s.watchCount > 1) {
    parts.push(`Watched ${s.watchCount}×`);
  }
  return parts.filter(Boolean).join(" · ") || null;
}
