import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { PosterCard, PosterGrid } from "@/components/PosterCard";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, completion, kindLabel, type MediaKind, type Section, statusLabel, type TrackState } from "@/lib/api";

const statuses: Record<Section, TrackState["status"][]> = {
  movie: ["watching", "completed"],
  show: ["watching", "completed"],
  anime: ["watching", "completed"],
  audiobook: ["listening", "finished"],
};

const title: Record<Section, string> = { ...kindLabel, anime: "Anime" };

/** Minimum ratings offered: TMDB rates out of 10, Audible out of 5. */
const ratingSteps = (section: Section) => (section === "audiobook" ? [4, 4.5] : [6, 7, 8]);

export function Library({ section }: { section: Section }) {
  // Filters live in the URL (?status=watching&genre=Drama…) so Back from an item returns to the same view.
  const [params, setParams] = useSearchParams();
  const f = {
    status: params.get("status") ?? "all",
    type: params.get("type") ?? "all", // anime only: show | movie
    genre: params.get("genre") ?? "",
    decade: params.get("decade") ?? "",
    rating: params.get("rating") ?? "",
  };
  const set = (key: keyof typeof f, value: string) => {
    const next = new URLSearchParams(params);
    if (!value || value === "all") next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };
  const { data, isLoading } = useQuery({ queryKey: ["library", section], queryFn: () => api.library(section) });
  const all = data ?? [];

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

  const items = all.filter(
    ({ media, state }) =>
      (f.status === "all" || state.status === f.status) &&
      (f.type === "all" || media.kind === f.type) &&
      (!f.genre || media.genres.includes(f.genre)) &&
      (!f.decade || (media.year != null && Math.floor(media.year / 10) * 10 === Number(f.decade))) &&
      (!f.rating || (media.extra.rating ?? 0) >= Number(f.rating)),
  );
  const filtered = Boolean(f.genre || f.decade || f.rating || f.type !== "all" || f.status !== "all");

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
          <Filter label="Rating" value={f.rating} onChange={(v) => set("rating", v)}>
            {ratingSteps(section).map((r) => (
              <option key={r} value={r}>
                {r}+ {section === "audiobook" ? "stars" : "on TMDB"}
              </option>
            ))}
          </Filter>
          {filtered && (
            <button
              type="button"
              onClick={() => setParams({}, { replace: true })}
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
        {items.map(({ media, state }) => (
          <PosterCard
            key={media.key}
            to={`/media/${media.key}`}
            kind={media.kind}
            title={media.title}
            poster={media.poster}
            sub={subline(media.kind, state, media.extra.subtitle ?? null, media.year)}
            progress={completion(media, state)}
            badge={state.status === "completed" || state.status === "finished" ? undefined : statusLabel[state.status]}
          />
        ))}
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
