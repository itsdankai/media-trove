import { describe, expect, it } from "vitest";
import { openDb } from "./db.ts";
import { appendEvents, eventsFor, type NewEvent, project } from "./events.ts";

const show = "tmdb-show-2426"; // Buffy
const at = (m: number) => new Date(Date.UTC(2026, 9, 6, 0, m)).toISOString();
const ep = (kind: NewEvent["kind"], source: string, m: number): NewEvent => ({
  mediaKey: show,
  kind,
  season: 1,
  episode: 1,
  source,
  occurredAt: at(m),
});

function fold(list: NewEvent[], followUnmarks: boolean) {
  const db = openDb(":memory:");
  const res = list.map((e) => appendEvents(db, [e], Date.now(), { followUnmarks }));
  return { state: project("show", eventsFor(db, show)), refused: res.reduce((n, r) => n + r.refused, 0) };
}

describe("follow unmarks (sync rule 4, amended)", () => {
  it("with the switch off, an app's unmark is refused", () => {
    const r = fold([ep("watched", "nuvio", 1), ep("unwatched", "nuvio", 2)], false);
    expect(r.refused).toBe(1);
    expect(r.state.watchedEpisodes).toEqual(["s1e1"]);
  });

  it("with it on, an app's unmark removes what that app reported", () => {
    expect(fold([ep("watched", "nuvio", 1), ep("unwatched", "nuvio", 2)], true).state.watchedEpisodes).toEqual([]);
  });

  it("never removes the user's own mark", () => {
    expect(fold([ep("watched", "manual", 1), ep("unwatched", "nuvio", 2)], true).state.watchedEpisodes).toEqual([
      "s1e1",
    ]);
  });

  it("never removes another app's mark", () => {
    const r = fold([ep("watched", "stremio", 1), ep("watched", "nuvio", 2), ep("unwatched", "nuvio", 3)], true);
    expect(r.state.watchedEpisodes).toEqual(["s1e1"]);
  });

  it("the user's unmark still clears everything", () => {
    const r = fold([ep("watched", "stremio", 1), ep("watched", "nuvio", 2), ep("unwatched", "manual", 3)], true);
    expect(r.state.watchedEpisodes).toEqual([]);
  });

  it("a later re-watch in the same app counts again", () => {
    const r = fold([ep("watched", "nuvio", 1), ep("unwatched", "nuvio", 2), ep("watched", "nuvio", 3)], true);
    expect(r.state.watchedEpisodes).toEqual(["s1e1"]);
  });
});
