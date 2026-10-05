import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Poster } from "@/components/PosterCard";
import { api, type EventRow } from "@/lib/api";

export function History() {
  const { data = [], isLoading } = useQuery({ queryKey: ["history"], queryFn: () => api.history(300) });

  const days = new Map<string, typeof data>();
  for (const row of data) {
    const day = new Date(row.event.occurredAt).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    days.set(day, [...(days.get(day) ?? []), row]);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">History</h1>
      {!isLoading && data.length === 0 && <p className="text-muted-foreground">Nothing tracked yet.</p>}
      {[...days].map(([day, rows]) => (
        <section key={day} className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">{day}</h2>
          <ul className="divide-y rounded-xl border bg-card">
            {rows.map(({ event, title, poster, mediaKind }) => (
              <li key={event.id}>
                <Link
                  to={`/media/${event.mediaKey}`}
                  className="flex items-center gap-4 p-3 transition-colors hover:bg-accent/60"
                >
                  <Poster
                    src={poster}
                    kind={mediaKind ?? "movie"}
                    title={title ?? ""}
                    className="w-10 shrink-0 rounded-md"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{title ?? event.mediaKey}</p>
                    <p className="text-sm text-muted-foreground">{describe(event)}</p>
                  </div>
                  <time className="text-xs text-muted-foreground">
                    {new Date(event.occurredAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                  </time>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function describe(e: EventRow) {
  const ep = e.season != null && e.episode != null ? ` S${e.season} · E${e.episode}` : "";
  switch (e.kind) {
    case "watched":
      return `Watched${ep}`;
    case "unwatched":
      return `Unmarked${ep}`;
    case "progress":
      return `Listened to ${Math.round((e.progress ?? 0) * 100)}%`;
    case "finished":
      return "Finished";
  }
}
