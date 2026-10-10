import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { CalendarDays, ChevronLeft, ChevronRight, List } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Poster } from "@/components/PosterCard";
import { menuForKey, PosterMenu } from "@/components/PosterMenu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, type CalendarEntry } from "@/lib/api";
import { friendlyError } from "@/lib/errors";

const ranges = { 30: "30 days", 90: "3 months", 365: "A year" } as const;
const types = { all: "All", show: "TV", anime: "Anime", movie: "Movies", audiobook: "Audiobooks" } as const;
/** Same split as the library: anime has its own tab and leaves TV and Movies. */
const inType = (e: CalendarEntry, t: keyof typeof types) =>
  t === "all" || (t === "anime" ? e.anime : !e.anime && e.kind === t);
const newLabel: Record<CalendarEntry["kind"], string> = { show: "", movie: "New movie", audiobook: "New book" };

/** Upcoming episodes of shows you watch, new movies in franchises you've seen, new books by your authors. */
export function Calendar() {
  // View, type and range live in the URL, so Back from an item returns to the same view.
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "month" ? "month" : "list";
  const type = (params.get("type") ?? "all") as keyof typeof types;
  const days = (Number(params.get("days")) || 90) as keyof typeof ranges;
  const set = (key: string, value: string, fallback: string) => {
    const next = new URLSearchParams(params);
    if (value === fallback) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const { data = [], isLoading, error } = useQuery({ queryKey: ["calendar", days], queryFn: () => api.calendar(days) });
  const entries = data.filter((e) => inType(e, type));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-primary fx-neon fx-title">Calendar</h1>
          <p className="text-sm text-muted-foreground">
            New episodes of shows you watch, new movies in franchises you've seen, and new books by your authors.
          </p>
        </div>
        <Tabs value={view} onValueChange={(v) => set("view", v, "list")}>
          <TabsList>
            <TabsTrigger value="list">
              <List /> List
            </TabsTrigger>
            <TabsTrigger value="month">
              <CalendarDays /> Month
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex flex-wrap gap-2">
        <Tabs value={type} onValueChange={(v) => set("type", v, "all")}>
          <TabsList>
            {Object.entries(types).map(([t, label]) => (
              <TabsTrigger key={t} value={t}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {view === "list" && (
          <Tabs value={String(days)} onValueChange={(v) => set("days", v, "90")}>
            <TabsList>
              {Object.entries(ranges).map(([d, label]) => (
                <TabsTrigger key={d} value={d}>
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Checking release dates…</p>}
      {error && <p className="text-sm text-destructive">{friendlyError(error)}</p>}
      {!isLoading && !error && view === "list" && <ListView entries={entries} />}
      {!isLoading && !error && view === "month" && (
        <MonthView entries={entries} onNeedMore={() => set("days", "365", "90")} />
      )}
    </div>
  );
}

/** The library, for each entry's right-click (long-press) menu: the same quick options as a poster (builder, 2026-10-10). */
const useLibrary = () => useQuery({ queryKey: ["library"], queryFn: () => api.library() }).data ?? [];

function ListView({ entries }: { entries: CalendarEntry[] }) {
  const library = useLibrary();
  if (!entries.length)
    return (
      <p className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
        Nothing coming up in this window.
      </p>
    );
  const byDay = new Map<string, CalendarEntry[]>();
  for (const e of entries) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  return (
    <div className="space-y-8">
      {[...byDay].map(([date, list]) => (
        <section key={date} className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">{dayLabel(date)}</h2>
          <ul className="divide-y rounded-xl border bg-card">
            {list.map((e) => (
              <li key={`${e.key}-${e.label}`}>
                <PosterMenu info={menuForKey(library, e.key, e.kind, e.date)}>
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
                    {!e.tracked && <Badge variant="outline">{newLabel[e.kind]}</Badge>}
                  </Link>
                </PosterMenu>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

const PER_CELL = 3;

/** A month grid (weeks starting Sunday). Each day shows its first few releases, then "+N". */
function MonthView({ entries, onNeedMore }: { entries: CalendarEntry[]; onNeedMore: () => void }) {
  const library = useLibrary();
  const today = new Date();
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const byDay = new Map<string, CalendarEntry[]>();
  for (const e of entries) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);

  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const cells = Array.from(
    { length: 42 },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  );
  const weeks = cells[35].getMonth() === month.getMonth() ? 6 : 5;
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const todayIso = iso(today);
  const step = (n: number) => {
    const next = new Date(month.getFullYear(), month.getMonth() + n, 1);
    setMonth(next);
    // Looking past the next three months needs the longer range.
    if (next.getTime() - today.getTime() > 80 * 86_400_000) onNeedMore();
  };
  const weekdays = cells.slice(0, 7).map((d) => d.toLocaleDateString(undefined, { weekday: "short" }));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">
          {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </h2>
        <div className="flex gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => step(-1)}
            aria-label="Previous month"
            disabled={month <= new Date(today.getFullYear(), today.getMonth(), 1)}
          >
            <ChevronLeft />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => step(1)} aria-label="Next month">
            <ChevronRight />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-xl border bg-card text-xs">
        {weekdays.map((w) => (
          <div key={w} className="border-b px-2 py-1.5 text-center font-medium text-muted-foreground">
            {w}
          </div>
        ))}
        {cells.slice(0, weeks * 7).map((d) => {
          const key = iso(d);
          // Several episodes of one show on one day (a season drop) make one line: "Title ×3".
          const grouped = new Map<string, { e: CalendarEntry; n: number }>();
          for (const e of byDay.get(key) ?? []) {
            const g = grouped.get(e.key);
            if (g) g.n++;
            else grouped.set(e.key, { e, n: 1 });
          }
          const list = [...grouped.values()];
          const inMonth = d.getMonth() === month.getMonth();
          return (
            <div
              key={key}
              className={cn(
                "min-h-24 border-b border-r p-1 sm:min-h-28",
                !inMonth && "bg-muted/30 text-muted-foreground",
              )}
            >
              <div className={cn("mb-1 px-1 text-right", key === todayIso && "font-semibold text-primary")}>
                {d.getDate()}
              </div>
              <ul className="space-y-0.5">
                {list.slice(0, PER_CELL).map(({ e, n }) => (
                  <li key={e.key}>
                    <PosterMenu info={menuForKey(library, e.key, e.kind, e.date)}>
                      <Link
                        to={`/media/${e.key}`}
                        title={n > 1 ? `${e.title} · ${n} episodes` : `${e.title} · ${e.label}`}
                        className={cn(
                          "block truncate rounded px-1 py-0.5 hover:bg-accent/60",
                          e.anime && "bg-kind-anime/15",
                          !e.anime && e.kind === "show" && "bg-primary/10",
                          !e.anime && e.kind === "movie" && "bg-kind-movie/10",
                          e.kind === "audiobook" && "bg-kind-audiobook/10",
                        )}
                      >
                        {e.title}
                        {n > 1 && <span className="text-muted-foreground"> ×{n}</span>}
                      </Link>
                    </PosterMenu>
                  </li>
                ))}
                {list.length > PER_CELL && (
                  <li className="px-1 text-muted-foreground">+{list.length - PER_CELL} more</li>
                )}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="size-2.5 rounded-sm bg-primary/40" /> TV
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2.5 rounded-sm bg-kind-anime/40" /> Anime
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2.5 rounded-sm bg-kind-movie/40" /> Movies
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2.5 rounded-sm bg-kind-audiobook/40" /> Audiobooks
        </span>
      </p>
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
