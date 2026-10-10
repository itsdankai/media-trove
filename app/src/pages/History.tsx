import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { Poster } from "@/components/PosterCard";
import { type ActivityGroup, groupProgress, progressSpan, timeSpan } from "@/lib/activity";
import { api, type EventRow, type MediaKind } from "@/lib/api";

/** Lines shown per day before "Show all" (builder, 2026-10-08). */
const PER_DAY = 10;

export function History() {
  const { data = [], isLoading } = useQuery({ queryKey: ["history"], queryFn: () => api.history(300) });
  const [open, setOpen] = useState<Set<string>>(new Set()); // days expanded with "Show all"

  // Position updates for the same item, app and day become one line (groupProgress).
  const days = new Map<string, ActivityGroup<(typeof data)[number]>[]>();
  for (const g of groupProgress(
    data,
    (r) => r.event,
    (r) => r.sourceName,
  )) {
    const day = new Date(g.last.occurredAt).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    days.set(day, [...(days.get(day) ?? []), g]);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight text-primary fx-neon fx-title">History</h1>
      {!isLoading && data.length === 0 && <p className="text-muted-foreground">Nothing tracked yet.</p>}
      {[...days].map(([day, groups]) => (
        <section key={day} className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">{day}</h2>
          <ul className="divide-y rounded-xl border bg-card">
            {(open.has(day) ? groups : groups.slice(0, PER_DAY)).map((g) => {
              const { title, poster, mediaKind, sourceName } = g.rows[0];
              return (
                <li key={g.last.id}>
                  <Link
                    to={`/media/${g.last.mediaKey}`}
                    className="flex items-center gap-4 p-3 transition-colors hover:bg-accent/60"
                  >
                    <Poster
                      src={poster}
                      kind={mediaKind ?? "movie"}
                      title={title ?? ""}
                      className="w-10 shrink-0 rounded-md"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{title ?? g.last.mediaKey}</p>
                      <p className="text-sm text-muted-foreground">{describeGroup(g, mediaKind, sourceName)}</p>
                    </div>
                    <time className="shrink-0 text-xs text-muted-foreground">{timeSpan(g)}</time>
                  </Link>
                </li>
              );
            })}
          </ul>
          {groups.length > PER_DAY && (
            <button
              type="button"
              onClick={() =>
                setOpen((s) => {
                  const next = new Set(s);
                  if (next.has(day)) next.delete(day);
                  else next.add(day);
                  return next;
                })
              }
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              {open.has(day) ? "Show fewer" : `Show all ${groups.length}`}
            </button>
          )}
        </section>
      ))}
    </div>
  );
}

export function describe(e: EventRow, kind?: MediaKind | null, sourceName = e.sourceName) {
  return describeGroup({ rows: [e], first: e, last: e }, kind, sourceName);
}

/** One activity line: "Watched S1 · E3 · via Stremio", "Listened 63% → 66% · via Audiobookshelf". */
export function describeGroup(g: ActivityGroup<unknown>, kind?: MediaKind | null, sourceName = g.last.sourceName) {
  const e = g.last;
  const ep = e.season != null && e.episode != null ? ` S${e.season} · E${e.episode}` : "";
  const apps = [e.source !== "manual" ? sourceName : undefined, ...(g.also ?? [])].filter(Boolean);
  const via = apps.length ? ` · via ${apps.join(" and ")}` : "";
  switch (e.kind) {
    case "watched":
      return `Watched${ep}${via}`;
    case "unwatched":
      return `Unmarked${ep}${via}`;
    case "progress": {
      const span = progressSpan(g);
      // A position of 0% means it was opened again from the start, not "watched to 0%".
      if (span === "0%") return `${kind === "audiobook" ? "Started listening" : `Started${ep}`}${via}`;
      const verb = kind === "audiobook" ? "Listened" : `Watched${ep}`;
      return `${verb} ${span.includes("→") ? span : `to ${span}`}${via}`;
    }
    case "finished":
      return `Finished${via}`;
  }
}
