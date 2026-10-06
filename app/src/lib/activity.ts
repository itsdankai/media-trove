// Activity lists group the many position updates an app sends (Audiobookshelf reports every few
// minutes) into one line per item, episode, app and day: "Listened 63% → 66%".
import type { EventRow } from "./api";

export type ActivityGroup<T> = { rows: T[]; first: EventRow; last: EventRow };

const dayOf = (iso: string) => new Date(iso).toLocaleDateString();

/** Rows newest first in, groups newest first out. Each group sits where its newest row was. */
export function groupProgress<T>(rows: T[], eventOf: (row: T) => EventRow): ActivityGroup<T>[] {
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
