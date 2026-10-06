import { useQuery } from "@tanstack/react-query";
import { Clapperboard, Headphones, Tv } from "lucide-react";
import { Link } from "react-router";
import { PosterCard, PosterGrid } from "@/components/PosterCard";
import { Card } from "@/components/ui/card";
import { api, completion, kindLabel, kindPath, type MediaKind, statusLabel } from "@/lib/api";

const icons = { movie: Clapperboard, show: Tv, audiobook: Headphones };

export function Home() {
  const { data = [], isLoading } = useQuery({ queryKey: ["library"], queryFn: () => api.library() });
  const inProgress = data.filter((i) => i.state.status === "watching" || i.state.status === "listening");
  const recent = data
    .filter((i) => i.state.status === "completed" || i.state.status === "caught_up" || i.state.status === "finished")
    .slice(0, 14);
  const count = (k: MediaKind) => data.filter((i) => i.media.kind === k).length;

  return (
    <div className="space-y-10">
      <div className="grid grid-cols-3 gap-3 md:gap-4">
        {(["movie", "show", "audiobook"] as const).map((k) => {
          const Icon = icons[k];
          return (
            <Link key={k} to={kindPath[k]}>
              <Card className="flex-row items-center gap-3 p-4 transition-colors hover:bg-accent">
                <Icon className="hidden size-8 shrink-0 text-primary sm:block" />
                <div>
                  <p className="text-2xl font-semibold leading-none">{count(k)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{kindLabel[k]}</p>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>

      {!isLoading && data.length === 0 && (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="text-lg font-medium">Your trove is empty</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Search for a movie, show, or audiobook above to start tracking.
          </p>
        </div>
      )}

      {inProgress.length > 0 && (
        <Row title="Continue">
          {inProgress.map(({ media, state }) => (
            <PosterCard
              key={media.key}
              to={`/media/${media.key}`}
              kind={media.kind}
              title={media.title}
              poster={media.poster}
              badge={statusLabel[state.status]}
              sub={media.year ? String(media.year) : null}
              progress={completion(media, state)}
            />
          ))}
        </Row>
      )}

      {recent.length > 0 && (
        <Row title="Recently finished">
          {recent.map(({ media }) => (
            <PosterCard
              key={media.key}
              to={`/media/${media.key}`}
              kind={media.kind}
              title={media.title}
              poster={media.poster}
              sub={media.year ? String(media.year) : null}
            />
          ))}
        </Row>
      )}
    </div>
  );
}

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">{title}</h2>
      <PosterGrid>{children}</PosterGrid>
    </section>
  );
}
