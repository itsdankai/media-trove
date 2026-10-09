import NumberFlow from "@number-flow/react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Clapperboard, Headphones, Sparkles, Tv } from "lucide-react";
import { Link } from "react-router";
import { PosterCard, PosterGrid } from "@/components/PosterCard";
import { Card } from "@/components/ui/card";
import { api, completion, type Media, type Section, statusLabel, type TrackState } from "@/lib/api";

type Item = { media: Media; state: TrackState };

/** Two rows of posters at the widest layout (7 columns); narrower screens show two rows of fewer. */
const ROW_LIMIT = 14;

const sections: { id: Section; label: string; path: string; icon: typeof Tv; verb: string }[] = [
  { id: "movie", label: "Movies", path: "/movies", icon: Clapperboard, verb: "Continue watching" },
  { id: "show", label: "Shows", path: "/shows", icon: Tv, verb: "Continue watching" },
  { id: "anime", label: "Anime", path: "/anime", icon: Sparkles, verb: "Continue watching" },
  { id: "audiobook", label: "Audiobooks", path: "/audiobooks", icon: Headphones, verb: "Continue listening" },
];

/** Same split as the library pages: anime (movies and shows) has its own section. */
const inSection = (s: Section, m: Media) =>
  s === "anime" ? m.kind !== "audiobook" && m.extra.anime === true : m.kind === s && m.extra.anime !== true;

const inProgress = (i: Item) => i.state.status === "watching" || i.state.status === "listening";

export function Home() {
  const { data = [], isLoading } = useQuery({ queryKey: ["library"], queryFn: () => api.library() });
  // Watchlist titles not started yet live on the library's Watchlist tab, not here.
  const started = data.filter((i) => i.state.status !== "planned");
  const recent = started.slice(0, ROW_LIMIT); // the API sorts by latest activity

  return (
    <div className="space-y-10">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {sections.map((s) => (
          <Link key={s.id} to={s.path}>
            <Card className="flex-row items-center gap-3 p-4 transition-colors hover:bg-accent">
              <s.icon className="hidden size-8 shrink-0 text-primary sm:block" />
              <div>
                <p className="text-2xl font-semibold leading-none">
                  <NumberFlow value={started.filter((i) => inSection(s.id, i.media)).length} />
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{s.label}</p>
              </div>
            </Card>
          </Link>
        ))}
      </div>

      {!isLoading && started.length === 0 && (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="text-lg font-medium">Your trove is empty</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Search for a movie, show, or audiobook above to start tracking.
          </p>
        </div>
      )}

      {recent.length > 0 && (
        <Row title="Most recent">
          {recent.map((i) => (
            <HomeCard key={i.media.key} item={i} />
          ))}
        </Row>
      )}

      {sections.map((s) => {
        const items = started.filter((i) => inSection(s.id, i.media) && inProgress(i)).slice(0, ROW_LIMIT);
        if (!items.length) return null;
        const status = s.id === "audiobook" ? "listening" : "watching";
        return (
          <Row key={s.id} title={`${s.label} · ${s.verb}`} more={`${s.path}?status=${status}`}>
            {items.map((i) => (
              <HomeCard key={i.media.key} item={i} />
            ))}
          </Row>
        );
      })}
    </div>
  );
}

function HomeCard({ item: { media, state } }: { item: Item }) {
  const done = state.status === "completed" || state.status === "finished";
  return (
    <PosterCard
      to={`/media/${media.key}`}
      kind={media.kind}
      title={media.title}
      poster={media.poster}
      rated={{ mediaKey: media.key, anime: media.extra.anime, score: media.extra.rating }}
      badge={done ? undefined : statusLabel[state.status]}
      sub={media.year ? String(media.year) : null}
      progress={completion(media, state)}
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
