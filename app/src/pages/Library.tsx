import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { PosterCard, PosterGrid } from "@/components/PosterCard";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, completion, kindLabel, type MediaKind, statusLabel, type TrackState } from "@/lib/api";

// Full filters (genre, year, rating) arrive in phase 6; status is enough to start.
const statuses: Record<MediaKind, TrackState["status"][]> = {
  movie: ["watching", "completed"],
  show: ["watching", "completed"],
  audiobook: ["listening", "finished"],
};

export function Library({ kind }: { kind: MediaKind }) {
  // The filter lives in the URL (?status=listening) so Back from an item returns to the same view.
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "all";
  const setStatus = (s: string) => setParams(s === "all" ? {} : { status: s }, { replace: true });
  const { data, isLoading } = useQuery({ queryKey: ["library", kind], queryFn: () => api.library(kind) });
  const items = (data ?? []).filter((i) => status === "all" || i.state.status === status);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{kindLabel[kind]}</h1>
          <p className="text-sm text-muted-foreground">{data ? `${data.length} tracked` : " "}</p>
        </div>
        {statuses[kind].length > 1 && (
          <Tabs value={status} onValueChange={setStatus}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              {statuses[kind].map((s) => (
                <TabsTrigger key={s} value={s}>
                  {statusLabel[s]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
      </div>

      {!isLoading && items.length === 0 && (
        <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          Nothing here yet. Use the search bar to find something, then track it.{" "}
          <Link to="/search" className="text-primary underline-offset-4 hover:underline">
            Search
          </Link>
        </div>
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
