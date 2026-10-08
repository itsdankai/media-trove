import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Clapperboard, Headphones, Sparkles, Tv } from "lucide-react";
import { Link } from "react-router";
import { PosterCard, PosterGrid } from "@/components/PosterCard";
import { api, completion, type Media, type Section, statusLabel, type TrackState } from "@/lib/api";

type Item = { media: Media; state: TrackState };

/** Two rows of posters at the widest layout (7 columns); narrower screens show two rows of fewer. */
const ROW_LIMIT = 14;

const sections: { id: Section; label: string; path: string; icon: typeof Tv }[] = [
  { id: "movie", label: "Movies", path: "/movies", icon: Clapperboard },
  { id: "show", label: "Shows", path: "/shows", icon: Tv },
  { id: "anime", label: "Anime", path: "/anime", icon: Sparkles },
  { id: "audiobook", label: "Audiobooks", path: "/audiobooks", icon: Headphones },
];

/** Same split as the library pages: anime (movies and shows) has its own section. */
const inSection = (s: Section, m: Media) =>
  s === "anime" ? m.kind !== "audiobook" && m.extra.anime === true : m.kind === s && m.extra.anime !== true;

const inProgress = (i: Item) => i.state.status === "watching" || i.state.status === "listening";

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

// Home answers "what now?" first (critique 2026-10-08): a greeting, then everything in progress, then what
// was recently finished. Counts live in the greeting line as links instead of a row of stat tiles.
export function Home() {
  const { data = [], isLoading } = useQuery({ queryKey: ["library"], queryFn: () => api.library() });
  // Watchlist titles not started yet live on the library's Watchlist tab, not here.
  const started = data.filter((i) => i.state.status !== "planned");
  const upNext = started.filter(inProgress); // the API sorts by latest activity
  const finished = started.filter((i) => !inProgress(i)).slice(0, ROW_LIMIT);
  const counts = sections
    .map((s) => ({ ...s, n: started.filter((i) => inSection(s.id, i.media)).length }))
    .filter((s) => s.n > 0);

  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">{greeting()}</h1>
        {counts.length > 0 && (
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {counts.map((s) => (
              <Link key={s.id} to={s.path} className="inline-flex items-center gap-1.5 hover:text-foreground">
                <s.icon className="size-4" />
                <span className="font-medium text-foreground tabular-nums">{s.n}</span> {s.label.toLowerCase()}
              </Link>
            ))}
          </p>
        )}
      </header>

      {!isLoading && started.length === 0 && (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="text-lg font-medium">Your trove is empty</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Search for a movie, show, or audiobook above to start tracking.
          </p>
        </div>
      )}

      {upNext.length > 0 && (
        <Row title="Up next" count={upNext.length}>
          {upNext.slice(0, ROW_LIMIT).map((i) => (
            <HomeCard key={i.media.key} item={i} />
          ))}
        </Row>
      )}

      {finished.length > 0 && (
        <Row title="Recently finished">
          {finished.map((i) => (
            <HomeCard key={i.media.key} item={i} />
          ))}
        </Row>
      )}
    </div>
  );
}

/** Where you are in it: "S2 · E4" for a show, "63% listened" for a book, else the year. */
function whereAt(media: Media, state: TrackState) {
  if (state.current) return `S${state.current.season} · E${state.current.episode}`;
  if (media.kind === "audiobook" && state.progress) return `${Math.round(state.progress * 100)}% listened`;
  return media.year ? String(media.year) : null;
}

function HomeCard({ item: { media, state } }: { item: Item }) {
  return (
    <PosterCard
      to={`/media/${media.key}`}
      kind={media.kind}
      title={media.title}
      poster={media.poster}
      rated={{ mediaKey: media.key, anime: media.extra.anime, score: media.extra.rating }}
      badge={state.status === "caught_up" ? statusLabel.caught_up : undefined}
      sub={inProgress({ media, state }) ? whereAt(media, state) : media.year ? String(media.year) : null}
      progress={completion(media, state)}
    />
  );
}

function Row({
  title,
  count,
  more,
  children,
}: {
  title: string;
  count?: number;
  more?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-medium">
          {title}
          {count != null && <span className="ml-2 text-muted-foreground tabular-nums">{count}</span>}
        </h2>
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
