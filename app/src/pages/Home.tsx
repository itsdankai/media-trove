import NumberFlow from "@number-flow/react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { Link } from "react-router";
import type { Moving, MovingIcon } from "@/components/Layout";
import { PosterCard, PosterGrid } from "@/components/PosterCard";
import { menuFor, menuForKey } from "@/components/PosterMenu";
import { ClapperboardIcon } from "@/components/ui/clapperboard-icon";
import { HeadphonesIcon } from "@/components/ui/headphones-icon";
import { SparklesIcon } from "@/components/ui/sparkles-icon";
import { TvIcon } from "@/components/ui/tv-icon";
import {
  api,
  type CalendarEntry,
  completion,
  formatMinutes,
  type Media,
  type Section,
  statusLabel,
  type TrackState,
} from "@/lib/api";

type Item = { media: Media; state: TrackState; watchlistedAt: number | null; favoritedAt: number | null };

/** Two rows of posters at the widest layout (7 columns); narrower screens show two rows of fewer. */
const ROW_LIMIT = 14;

// The same animated icons as the sidebar, so they play on hover there and here alike (builder, 2026-10-10).
const sections: { id: Section; label: string; path: string; icon: MovingIcon }[] = [
  { id: "movie", label: "Movies", path: "/movies", icon: ClapperboardIcon },
  { id: "show", label: "Shows", path: "/shows", icon: TvIcon },
  { id: "anime", label: "Anime", path: "/anime", icon: SparklesIcon },
  { id: "audiobook", label: "Audiobooks", path: "/audiobooks", icon: HeadphonesIcon },
];

/** One count in the strip: its icon plays while the pill is hovered or focused. */
function SectionLink({ path, icon: Icon, children }: { path: string; icon: MovingIcon; children: ReactNode }) {
  const icon = useRef<Moving>(null);
  const play = () => icon.current?.startAnimation();
  const stop = () => icon.current?.stopAnimation();
  return (
    <Link
      to={path}
      onMouseEnter={play}
      onMouseLeave={stop}
      onFocus={play}
      onBlur={stop}
      className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm transition-colors hover:bg-accent"
    >
      <Icon ref={icon} size={16} className="flex text-primary" />
      {children}
    </Link>
  );
}

/** Same split as the library pages: anime (movies and shows) has its own section. */
const inSection = (s: Section, m: Media) =>
  s === "anime" ? m.kind !== "audiobook" && m.extra.anime === true : m.kind === s && m.extra.anime !== true;

const inProgress = (i: Item) => i.state.status === "watching" || i.state.status === "listening";

export function Home() {
  const { data = [], isLoading } = useQuery({ queryKey: ["library"], queryFn: () => api.library() });
  const { data: upcoming = [] } = useQuery({ queryKey: ["calendar", 14], queryFn: () => api.calendar(14) });
  // Watchlist titles not started yet live on the Watchlist page, not here.
  const started = data.filter((i) => i.state.status !== "planned");
  // What you're in the middle of, any kind, most recent first: the reason to open Home (Astra critique 2026-10-09;
  // builder approved moving this above the counts and Most recent, 2026-10-10).
  const going = started.filter(inProgress).slice(0, ROW_LIMIT);
  const recent = started.slice(0, ROW_LIMIT); // the API sorts by latest activity
  const next = upNext(upcoming);

  return (
    <div className="space-y-10">
      {/* The collection totals, kept as a compact strip of links to each library page. */}
      <nav aria-label="Your library" className="flex flex-wrap gap-2">
        {sections.map((s) => (
          <SectionLink key={s.id} path={s.path} icon={s.icon}>
            <span className="font-semibold tabular-nums text-primary">
              <NumberFlow value={started.filter((i) => inSection(s.id, i.media)).length} />
            </span>
            <span className="text-muted-foreground">{s.label}</span>
          </SectionLink>
        ))}
      </nav>

      {!isLoading && started.length === 0 && (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="text-lg font-medium">Your trove is empty</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Search for a movie, show, or audiobook above to start tracking.
          </p>
        </div>
      )}

      {going.length > 0 && (
        <Row title="Continue">
          {going.map((i) => (
            <HomeCard key={i.media.key} item={i} sub={leftToGo(i)} />
          ))}
        </Row>
      )}

      {next.length > 0 && (
        <Row title="Up next" more="/calendar">
          {next.map((e) => (
            <PosterCard
              key={`${e.key}-${e.date}`}
              to={`/media/${e.key}`}
              kind={e.kind}
              title={e.title}
              poster={e.poster}
              badge={dayName(e.date)}
              sub={e.label || null}
              menu={menuForKey(data, e.key, e.kind, e.date)}
            />
          ))}
        </Row>
      )}

      {recent.length > 0 && (
        <Row title="Most recent">
          {recent.map((i) => (
            <HomeCard key={i.media.key} item={i} />
          ))}
        </Row>
      )}
    </div>
  );
}

/** "S2 · E5" for a show, "3h 41m left" for a book or film, from what the apps last reported. */
function leftToGo({ media, state }: Item) {
  if (media.kind === "show") {
    if (state.current) return `S${state.current.season} · E${state.current.episode}`;
    const episodes = Math.max(media.extra.airedEpisodes ?? 0, media.extra.totalEpisodes ?? 0);
    const seen = state.watchedEpisodes?.length ?? 0;
    return episodes ? `${seen} of ${episodes} episodes` : statusLabel[state.status];
  }
  const total = media.kind === "audiobook" ? media.extra.runtimeMin : media.extra.runtime;
  const left = total && state.progress ? Math.round(total * (1 - state.progress)) : null;
  return left ? `${formatMinutes(left)} left` : statusLabel[state.status];
}

/** The calendar's next two weeks, tracked titles only, each title once (its soonest entry). */
function upNext(entries: CalendarEntry[]) {
  const seen = new Set<string>();
  return entries.filter((e) => e.tracked && !seen.has(e.key) && seen.add(e.key)).slice(0, ROW_LIMIT);
}

function dayName(date: string) {
  const d = new Date(`${date}T12:00:00`);
  const today = new Date();
  const days = Math.round((d.setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  return new Date(`${date}T12:00:00`).toLocaleDateString(
    undefined,
    days < 7 ? { weekday: "long" } : { month: "short", day: "numeric" },
  );
}

function HomeCard({ item, sub }: { item: Item; sub?: string }) {
  const { media, state, favoritedAt } = item;
  const done = state.status === "completed" || state.status === "finished";
  return (
    <PosterCard
      to={`/media/${media.key}`}
      kind={media.kind}
      title={media.title}
      poster={media.poster}
      rated={{ mediaKey: media.key, anime: media.extra.anime, score: media.extra.rating }}
      badge={done || sub ? undefined : statusLabel[state.status]}
      sub={sub ?? (media.year ? String(media.year) : null)}
      progress={completion(media, state)}
      starred={favoritedAt != null}
      menu={menuFor(item)}
    />
  );
}

function Row({ title, more, children }: { title: string; more?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-medium">{title}</h2>
        {more && (
          <Link to={more} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
            See all <ChevronRight className="size-4" />
          </Link>
        )}
      </div>
      <PosterGrid twoRows>{children}</PosterGrid>
    </section>
  );
}
