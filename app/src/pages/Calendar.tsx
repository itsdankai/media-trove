import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { Poster } from "@/components/PosterCard";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, type CalendarEntry } from "@/lib/api";

const ranges = { 30: "30 days", 90: "3 months", 365: "A year" } as const;

/** Upcoming episodes of shows you track, and new audiobooks from authors you track. */
export function Calendar() {
  const [days, setDays] = useState<keyof typeof ranges>(90);
  const { data = [], isLoading, error } = useQuery({ queryKey: ["calendar", days], queryFn: () => api.calendar(days) });

  const byDay = new Map<string, CalendarEntry[]>();
  for (const e of data) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
          <p className="text-sm text-muted-foreground">
            New episodes of shows you're tracking, and new audiobooks from authors you listen to.
          </p>
        </div>
        <Tabs value={String(days)} onValueChange={(v) => setDays(Number(v) as keyof typeof ranges)}>
          <TabsList>
            {Object.entries(ranges).map(([d, label]) => (
              <TabsTrigger key={d} value={d}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Checking release dates…</p>}
      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {!isLoading && !error && data.length === 0 && (
        <p className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          Nothing coming up in this window.
        </p>
      )}

      {[...byDay].map(([date, entries]) => (
        <section key={date} className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">{dayLabel(date)}</h2>
          <ul className="divide-y rounded-xl border bg-card">
            {entries.map((e) => (
              <li key={`${e.key}-${e.label}`}>
                <Link
                  to={`/media/${e.key}`}
                  className="flex items-center gap-4 p-3 transition-colors hover:bg-accent/60"
                >
                  <Poster
                    src={e.poster}
                    kind={e.kind}
                    title={e.title}
                    className={e.kind === "audiobook" ? "w-12 shrink-0 rounded-md" : "w-10 shrink-0 rounded-md"}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{e.title}</p>
                    <p className="truncate text-sm text-muted-foreground">{e.label}</p>
                  </div>
                  {!e.tracked && <Badge variant="outline">New book</Badge>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** "Today", "Tomorrow", "Friday, October 9", then dates with the year when it isn't this year. */
function dayLabel(date: string) {
  const d = new Date(`${date}T12:00:00`);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return d.toLocaleDateString(undefined, {
    weekday: diff < 7 ? "long" : undefined,
    month: "long",
    day: "numeric",
    year: d.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
  });
}
