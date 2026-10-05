import type { Db } from "./db.ts";
import { settings } from "./db.ts";
import { DEFAULT_THRESHOLD } from "./events.ts";

export type Settings = {
  watchedThreshold: number; // 0.5..1 — progress at or above this counts as watched (sync rule 3)
  setupComplete: boolean;
};

const defaults: Settings = { watchedThreshold: DEFAULT_THRESHOLD, setupComplete: false };

export function getSettings(db: Db): Settings {
  const rows = db.select().from(settings).all();
  return { ...defaults, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
}

export function updateSettings(db: Db, patch: Partial<Settings>) {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
  }
  return getSettings(db);
}
