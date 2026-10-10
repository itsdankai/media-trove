import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import {
  ArrowLeft,
  BookmarkCheck,
  BookmarkPlus,
  CalendarClock,
  Check,
  CheckCheck,
  Eye,
  RotateCcw,
  Star,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { Confirm } from "@/components/Confirm";
import { Poster } from "@/components/PosterCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { groupProgress, timeSpan } from "@/lib/activity";
import {
  api,
  completion,
  type EventRow,
  formatMinutes,
  isOut,
  kindPath,
  type Media,
  type MediaKind,
  type NewEvent,
  statusLabel,
  type TrackState,
} from "@/lib/api";
import { friendlyError } from "@/lib/errors";
import { describeGroup } from "./History.tsx";

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
  if (error || !data) return <p className="text-muted-foreground">{error ? friendlyError(error) : "Not found."}</p>;
  const { media: m, state, events } = data;

  return (
    <div className="space-y-10">
      <Button variant="ghost" size="sm" className="-ml-2 -mb-6" onClick={back}>
        <ArrowLeft /> Back
      </Button>
      <section className="relative isolate -mx-4 px-4 pt-6 pb-8 md:-mx-8 md:px-8">
        {/* Only the blurred backdrop is clipped; the poster itself never is. */}
        <div className="absolute inset-0 -z-10 overflow-hidden">
          {m.extra.backdrop && (
            <img src={m.extra.backdrop} alt="" className="size-full object-cover opacity-20 blur-sm" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-transparent" />
        </div>
        {/* Phones: a small poster beside the title, then everything else full width, so the status, progress and
            buttons are on the first screen (Astra critique 2026-10-09). Wider: poster in its own column. */}
        <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-4 gap-y-5 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-x-6">
          <Poster
            src={m.poster}
            rated={{ mediaKey: m.key, anime: m.extra.anime, score: m.extra.rating }}
            kind={m.kind}
            title={m.title}
            starred={data.favorited}
            className="self-start shadow-2xl shadow-black/50 sm:row-span-2"
          />
          <div className="min-w-0 space-y-2 self-center sm:self-start">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{m.title}</h1>
            <p className="text-sm text-muted-foreground sm:text-base">{metaLine(m)}</p>
          </div>
          <div className="col-span-2 min-w-0 space-y-4 sm:col-span-1 sm:col-start-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>
                {state.status === "planned" && !data.watchlisted ? "Not tracked" : statusLabel[state.status]}
              </Badge>
              {m.genres.map((g) => (
                <Badge key={g} variant="secondary">
                  {g}
                </Badge>
              ))}
            </div>
            {/* A started title stays on the watchlist until Settings → Tracking's percentage; finished ones leave it. */}
            <div className="flex flex-wrap gap-2">
              {(data.watchlisted || !["completed", "finished", "caught_up"].includes(state.status)) && (
                <ListButton mediaKey={m.key} list="watchlist" on={data.watchlisted} />
              )}
              <ListButton mediaKey={m.key} list="favorite" on={data.favorited} />
            </div>
            {/* Nothing to watch or listen to before it's out: say when instead (builder 2026-10-10). */}
            {m.kind !== "show" && !isOut(m.extra.releaseDate) && <ComesOut date={m.extra.releaseDate} />}
            {m.kind === "movie" && isOut(m.extra.releaseDate) && <MovieActions m={m} state={state} track={track} />}
            {m.kind === "audiobook" && isOut(m.extra.releaseDate) && (
              <AudiobookActions m={m} state={state} track={track} />
            )}
            {m.kind === "show" && <ShowSummary m={m} state={state} />}
            {m.overview && <Overview text={m.overview} />}
          </div>
        </div>
      </section>

      {m.kind === "show" && <Seasons m={m} state={state} track={track} />}

      {events.length > 0 && <Activity events={events} kind={m.kind} />}
    </div>
  );
}

/** The synopsis, folded to three lines until asked for (it's for deciding, not for every visit). */
function Overview({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
      <p className={cn(!open && "line-clamp-3")}>{text}</p>
      {text.length > 180 && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mt-1 font-medium text-foreground underline-offset-4 hover:underline"
        >
          {open ? "Less" : "More"}
        </button>
      )}
    </div>
  );
}

const ACTIVITY_SHOWN = 8;

/** Newest first; position updates grouped per app and day, the latest few shown until asked for all. */
function Activity({ events, kind }: { events: EventRow[]; kind: MediaKind }) {
  const [all, setAll] = useState(false);
  const [raw, setRaw] = useState(false);
  const groups = raw ? events.map((e) => ({ rows: [e], first: e, last: e })) : groupProgress(events, (e) => e);
  const shown = all ? groups : groups.slice(0, ACTIVITY_SHOWN);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium">Activity</h2>
        {events.length > groups.length || raw ? (
          <button
            type="button"
            onClick={() => setRaw((r) => !r)}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            {raw ? "Group updates" : `Show every update (${events.length})`}
          </button>
        ) : null}
      </div>
      <ul className="divide-y rounded-xl border bg-card text-sm">
        {shown.map((g) => (
          <li key={g.last.id} className="flex justify-between gap-4 px-4 py-2.5">
            <span>{describeGroup(g, kind)}</span>
            <time className="shrink-0 text-right text-muted-foreground">
              {new Date(g.last.occurredAt).toLocaleDateString()}, {timeSpan(g)}
            </time>
          </li>
        ))}
      </ul>
      {groups.length > ACTIVITY_SHOWN && (
        <Button variant="ghost" size="sm" onClick={() => setAll((a) => !a)}>
          {all ? "Show less" : `Show all activity (${groups.length})`}
        </Button>
      )}
    </section>
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
      // GraphicAudio casts run to twenty names; the first two say enough.
      x.narrators?.length
        ? `Narrated by ${x.narrators.slice(0, 2).join(", ")}${x.narrators.length > 2 ? ` and ${x.narrators.length - 2} more` : ""}`
        : null,
      formatMinutes(x.runtimeMin),
      series,
      ratingLine(m),
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (m.kind === "show")
    return [
      m.year,
      x.seasons && `${x.seasons.length} season${x.seasons.length === 1 ? "" : "s"}`,
      x.status,
      ratingLine(m),
    ]
      .filter(Boolean)
      .join(" · ");
  return [m.year, formatMinutes(x.runtime), ratingLine(m)].filter(Boolean).join(" · ");
}

/** Where the rating comes from: "★ 8.5/10 TMDB (38,120 votes)", "★ 4.8/5 Audible (12,345 ratings)". */
function ratingLine(m: Media) {
  const x = m.extra;
  if (x.rating == null) return null;
  const n = (count?: number | null, word = "votes") => (count ? ` (${count.toLocaleString()} ${word})` : "");
  if (m.kind === "audiobook") return `★ ${x.rating}/5 Audible listeners${n(x.ratingCount, "ratings")}`;
  if (x.ratingSource === "anime community") return `★ ${x.rating}/10 anime community (MyAnimeList, AniList…)`;
  return `★ ${x.rating}/10 TMDB${n(x.voteCount)}`;
}

const listLabels = {
  watchlist: { on: "On your watchlist", off: "Add to watchlist" },
  favorite: { on: "Favorite", off: "Add to favorites" },
};

/** Save a title for later or star it as a favorite, or take it off that list. */
function ListButton({ mediaKey, list, on }: { mediaKey: string; list: "watchlist" | "favorite"; on: boolean }) {
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: () => api[list](mediaKey, !on),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["media", mediaKey] });
      qc.invalidateQueries({ queryKey: ["library"] });
    },
  });
  return (
    <Button
      variant={on ? "secondary" : list === "favorite" ? "outline" : "default"}
      onClick={() => toggle.mutate()}
      disabled={toggle.isPending}
      aria-pressed={on}
    >
      {list === "favorite" ? (
        <Star className={cn(on && "fill-amber-400 text-amber-400")} />
      ) : on ? (
        <BookmarkCheck />
      ) : (
        <BookmarkPlus />
      )}{" "}
      {listLabels[list][on ? "on" : "off"]}
    </Button>
  );
}

function ComesOut({ date }: { date?: string | null }) {
  const day = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { dateStyle: "long" });
  return (
    <p className="flex items-center gap-2 pt-2 text-sm text-muted-foreground">
      <CalendarClock className="size-4" /> Comes out {day}
    </p>
  );
}

function MovieActions({ m, state, track }: { m: Media; state: TrackState; track: Track }) {
  const watched = (state.watchCount ?? 0) > 0;
  return (
    <div className="flex flex-wrap items-center gap-3 pt-2">
      <Button onClick={() => track.mutate({ kind: "watched" })} disabled={track.isPending}>
        <Eye /> {watched ? "Watched again" : "Mark watched"}
      </Button>
      {watched && (
        <>
          <span className="text-sm text-muted-foreground">Watched {state.watchCount}×</span>
          <Confirm
            title={`Reset ${m.title}?`}
            description={`It goes back to not watched, and the count of ${state.watchCount} watch${state.watchCount === 1 ? "" : "es"} starts again from zero. Your History keeps the record.`}
            action="Reset"
            onConfirm={() => track.mutate({ kind: "unwatched" })}
          >
            <Button variant="ghost" size="sm" disabled={track.isPending}>
              <RotateCcw /> Reset
            </Button>
          </Confirm>
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
  const total = Math.max(aired, m.extra.totalEpisodes ?? 0);
  const watched = state.watchedEpisodes?.length ?? 0;
  const next = m.extra.nextEpisode;
  const notOut = total - aired;
  return (
    <div className="max-w-md space-y-2 pt-2">
      <div className="flex justify-between text-sm">
        <span className="font-medium">
          {watched} of {total} episodes watched
          {notOut > 0 && <span className="font-normal text-muted-foreground"> · {notOut} not out yet</span>}
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
                {/* Unwatched is an empty circle, watched a filled check (Astra critique 2026-10-09). */}
                {isSeen && <Check />}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
