// Activity lists group the many position updates an app sends (Audiobookshelf reports every few
// minutes) into one line per item, episode, app and day: "Listened 63% → 66%".
import type { EventRow } from "./api";

/** also: other apps that reported the same viewing (folded into this line, see foldViewings). */
export type ActivityGroup<T> = { rows: T[]; first: EventRow; last: EventRow; also?: string[] };

/** Two apps reporting one viewing land within seconds; events.ts counts marks this close as one watch. */
const SAME_VIEWING_MS = 12 * 60 * 60 * 1000;
/** A position this far in that came with a watch is the same viewing, not separate news. */
const DONE_PROGRESS = 0.9;

const dayOf = (iso: string) => new Date(iso).toLocaleDateString();

/** Rows newest first in, groups newest first out. Each group sits where its newest row was. */
export function groupProgress<T>(
  rows: T[],
  eventOf: (row: T) => EventRow,
  nameOf: (row: T) => string | undefined = (r) => eventOf(r).sourceName,
): ActivityGroup<T>[] {
  return foldViewings(groupPositions(rows, eventOf), eventOf, nameOf);
}

function groupPositions<T>(rows: T[], eventOf: (row: T) => EventRow): ActivityGroup<T>[] {
  const out: ActivityGroup<T>[] = [];
  const open = new Map<string, ActivityGroup<T>>();
  for (const row of rows) {
    const e = eventOf(row);
    if (e.kind !== "progress") {
      out.push({ rows: [row], first: e, last: e });
      continue;
    }
    const key = [dayOf(e.occurredAt), e.mediaKey, e.season, e.episode, e.source].join("|");
    const g = open.get(key);
    if (g) {
      g.rows.push(row);
      g.first = e; // rows come newest first, so this one is older
    } else {
      const fresh = { rows: [row], first: e, last: e };
      open.set(key, fresh);
      out.push(fresh);
    }
  }
  return out;
}

/**
 * Stremio and Nuvio often report the same viewing (and a "to 100%" position with it), which read as the same
 * episode watched twice (Astra critique 2026-10-09). Fold those into the newest watch: one line, "via A and B".
 */
function foldViewings<T>(
  groups: ActivityGroup<T>[],
  eventOf: (row: T) => EventRow,
  nameOf: (row: T) => string | undefined,
): ActivityGroup<T>[] {
  const gone = new Set<ActivityGroup<T>>();
  const same = (a: EventRow, b: EventRow) =>
    a.mediaKey === b.mediaKey &&
    a.season === b.season &&
    a.episode === b.episode &&
    Math.abs(Date.parse(a.occurredAt) - Date.parse(b.occurredAt)) <= SAME_VIEWING_MS;
  for (const g of groups) {
    if (gone.has(g) || (g.last.kind !== "watched" && g.last.kind !== "finished")) continue;
    const own = nameOf(g.rows[0]);
    for (const h of groups) {
      if (h === g || gone.has(h) || !same(g.last, h.last)) continue;
      const repeat = h.last.kind === g.last.kind && h.last.source !== g.last.source;
      const reached = h.last.kind === "progress" && (h.last.progress ?? 0) >= DONE_PROGRESS;
      if (!repeat && !reached) continue;
      gone.add(h);
      g.rows.push(...h.rows);
      const name = nameOf(h.rows[0]) ?? eventOf(h.rows[0]).source;
      if (h.last.source !== "manual" && name && name !== own && !g.also?.includes(name))
        g.also = [...(g.also ?? []), name];
    }
  }
  return groups.filter((g) => !gone.has(g));
}

const pct = (p: number | null | undefined) => `${Math.round((p ?? 0) * 100)}%`;

/** "63% → 66%", or just "66%" when it didn't move. */
export function progressSpan(g: ActivityGroup<unknown>) {
  const from = pct(g.first.progress);
  const to = pct(g.last.progress);
  return g.rows.length > 1 && from !== to ? `${from} → ${to}` : to;
}

export const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** "7:10 PM – 11:59 PM" for a group spanning time, else one time. */
export function timeSpan(g: ActivityGroup<unknown>) {
  const a = clock(g.first.occurredAt);
  const b = clock(g.last.occurredAt);
  return a === b ? b : `${a} – ${b}`;
}
