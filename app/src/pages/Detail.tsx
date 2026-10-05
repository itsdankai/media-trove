import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { ArrowLeft, Check, CheckCheck, Eye, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { Poster } from "@/components/PosterCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import {
  api,
  completion,
  formatMinutes,
  kindPath,
  type Media,
  type NewEvent,
  statusLabel,
  type TrackState,
} from "@/lib/api";
import { describe } from "./History.tsx";

export function Detail() {
  // biome-ignore lint/style/noNonNullAssertion: route always has :key
  const key = useParams().key!;
  const { data, error, isLoading } = useQuery({ queryKey: ["media", key], queryFn: () => api.media(key) });
  const track = useTrack(key);
  const navigate = useNavigate();
  const location = useLocation();
  // Back to wherever you came from (keeps the Listening/Finished filter); a direct link goes to the category.
  const back = () => (location.key !== "default" ? navigate(-1) : navigate(kindPath[data?.media.kind ?? "movie"]));

  if (isLoading) return <Skeleton className="h-80 w-full" />;
  if (error || !data) return <p className="text-muted-foreground">{error?.message ?? "Not found."}</p>;
  const { media: m, state, events } = data;

  return (
    <div className="space-y-10">
      <Button variant="ghost" size="sm" className="-ml-2 -mb-6" onClick={back}>
        <ArrowLeft /> Back
      </Button>
      <section className="relative -mx-4 overflow-hidden px-4 pt-6 pb-8 md:-mx-8 md:px-8">
        {m.extra.backdrop && (
          <img
            src={m.extra.backdrop}
            alt=""
            className="absolute inset-0 -z-10 size-full object-cover opacity-20 blur-sm"
          />
        )}
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-background via-background/70 to-transparent" />
        <div className="flex flex-col gap-6 sm:flex-row">
          <Poster
            src={m.poster}
            kind={m.kind}
            title={m.title}
            className="w-40 shrink-0 shadow-2xl shadow-black/50 sm:w-52"
          />
          <div className="min-w-0 flex-1 space-y-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">{m.title}</h1>
              <p className="mt-1 text-muted-foreground">{metaLine(m)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge>{statusLabel[state.status]}</Badge>
              {m.genres.map((g) => (
                <Badge key={g} variant="secondary">
                  {g}
                </Badge>
              ))}
            </div>
            {m.overview && <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{m.overview}</p>}
            {m.kind === "movie" && <MovieActions m={m} state={state} track={track} />}
            {m.kind === "audiobook" && <AudiobookActions m={m} state={state} track={track} />}
            {m.kind === "show" && <ShowSummary m={m} state={state} />}
          </div>
        </div>
      </section>

      {m.kind === "show" && <Seasons m={m} state={state} track={track} />}

      {events.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Activity</h2>
          <ul className="divide-y rounded-xl border bg-card text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex justify-between gap-4 px-4 py-2.5">
                <span>{describe(e, m.kind)}</span>
                <time className="text-muted-foreground">{new Date(e.occurredAt).toLocaleString()}</time>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function useTrack(key: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (e: Omit<NewEvent, "mediaKey"> | Omit<NewEvent, "mediaKey">[]) =>
      api.track(Array.isArray(e) ? e.map((x) => ({ ...x, mediaKey: key })) : { ...e, mediaKey: key }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["media", key] });
      qc.invalidateQueries({ queryKey: ["library"] });
      qc.invalidateQueries({ queryKey: ["history"] });
    },
  });
}
type Track = ReturnType<typeof useTrack>;

function metaLine(m: Media) {
  const x = m.extra;
  if (m.kind === "audiobook") {
    const series = x.series ? `${x.series.name}${x.series.position ? ` #${x.series.position}` : ""}` : null;
    return [
      x.authors?.join(", "),
      x.narrators?.length ? `Narrated by ${x.narrators.join(", ")}` : null,
      formatMinutes(x.runtimeMin),
      series,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (m.kind === "show")
    return [m.year, x.seasons && `${x.seasons.length} seasons`, x.status].filter(Boolean).join(" · ");
  return [m.year, formatMinutes(x.runtime)].filter(Boolean).join(" · ");
}

function MovieActions({ state, track }: { m: Media; state: TrackState; track: Track }) {
  const watched = (state.watchCount ?? 0) > 0;
  return (
    <div className="flex flex-wrap items-center gap-3 pt-2">
      <Button onClick={() => track.mutate({ kind: "watched" })} disabled={track.isPending}>
        <Eye /> {watched ? "Watched again" : "Mark watched"}
      </Button>
      {watched && (
        <>
          <span className="text-sm text-muted-foreground">Watched {state.watchCount}×</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => track.mutate({ kind: "unwatched" })}
            disabled={track.isPending}
          >
            <RotateCcw /> Reset
          </Button>
        </>
      )}
    </div>
  );
}

function AudiobookActions({ m, state, track }: { m: Media; state: TrackState; track: Track }) {
  const saved = Math.round((state.progress ?? 0) * 100);
  const [pct, setPct] = useState(saved);
  useEffect(() => setPct(saved), [saved]);
  const runtime = m.extra.runtimeMin;
  const left = runtime ? formatMinutes(Math.round(runtime * (1 - pct / 100))) : null;

  return (
    <div className="max-w-md space-y-3 pt-2">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{pct}% listened</span>
        {left && pct < 100 && <span className="text-muted-foreground">{left} left</span>}
      </div>
      <Slider value={[pct]} onValueChange={([v]) => setPct(v)} max={100} step={1} aria-label="Progress" />
      <div className="flex flex-wrap gap-3">
        <Button
          onClick={() => track.mutate({ kind: "progress", progress: pct / 100 })}
          disabled={track.isPending || pct === saved}
        >
          <Check /> Save progress
        </Button>
        {state.status !== "finished" && (
          <Button variant="secondary" onClick={() => track.mutate({ kind: "finished" })} disabled={track.isPending}>
            <CheckCheck /> Mark finished
          </Button>
        )}
      </div>
    </div>
  );
}

function ShowSummary({ m, state }: { m: Media; state: TrackState }) {
  const aired = m.extra.airedEpisodes ?? m.extra.totalEpisodes ?? 0;
  const watched = state.watchedEpisodes?.length ?? 0;
  const next = m.extra.nextEpisode;
  return (
    <div className="max-w-md space-y-2 pt-2">
      <div className="flex justify-between text-sm">
        <span className="font-medium">
          {watched} of {aired} episodes watched
        </span>
        <span className="text-muted-foreground">{Math.round(completion(m, state) * 100)}%</span>
      </div>
      <Progress value={completion(m, state) * 100} />
      {next && (
        <p className="text-sm text-muted-foreground">
          Next: S{next.season} · E{next.number} on {new Date(`${next.airDate}T12:00:00`).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}

function Seasons({ m, state, track }: { m: Media; state: TrackState; track: Track }) {
  const seasons = m.extra.seasons ?? [];
  const [n, setN] = useState(seasons[0]?.number ?? 1);
  const { data: episodes, isLoading } = useQuery({
    queryKey: ["season", m.key, n],
    queryFn: () => api.season(m.key, n),
  });
  const seen = new Set(state.watchedEpisodes);
  const today = new Date().toISOString().slice(0, 10);
  const aired = (episodes ?? []).filter((e) => e.airDate && e.airDate <= today);
  const unwatched = aired.filter((e) => !seen.has(`s${e.season}e${e.number}`));

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {seasons.map((s) => (
            <Button
              key={s.number}
              size="sm"
              variant={s.number === n ? "default" : "secondary"}
              onClick={() => setN(s.number)}
            >
              {s.name}
            </Button>
          ))}
        </div>
        {unwatched.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            disabled={track.isPending}
            onClick={() =>
              track.mutate(unwatched.map((e) => ({ kind: "watched", season: e.season, episode: e.number })))
            }
          >
            <CheckCheck /> Mark season watched
          </Button>
        )}
      </div>

      {isLoading && <Skeleton className="h-60 w-full" />}
      <ul className="divide-y rounded-xl border bg-card">
        {episodes?.map((e) => {
          const isSeen = seen.has(`s${e.season}e${e.number}`);
          const hasAired = Boolean(e.airDate && e.airDate <= today);
          return (
            <li key={e.number} className="flex items-center gap-4 p-3">
              {e.still ? (
                <img
                  src={e.still}
                  alt=""
                  loading="lazy"
                  className="hidden aspect-video w-32 rounded-md object-cover sm:block"
                />
              ) : (
                <div className="hidden aspect-video w-32 rounded-md bg-muted sm:block" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  <span className="text-muted-foreground">E{e.number}</span> {e.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {e.airDate ? new Date(`${e.airDate}T12:00:00`).toLocaleDateString() : "TBA"}
                </p>
              </div>
              <Button
                size="icon"
                variant={isSeen ? "default" : "outline"}
                className={cn("rounded-full", !hasAired && "invisible")}
                aria-label={isSeen ? `Unmark episode ${e.number}` : `Mark episode ${e.number} watched`}
                aria-pressed={isSeen}
                disabled={track.isPending}
                onClick={() =>
                  track.mutate({ kind: isSeen ? "unwatched" : "watched", season: e.season, episode: e.number })
                }
              >
                <Check />
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
