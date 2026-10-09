// The one place that knows where data lives. Override with MEDIATROVE_DATA_DIR (Docker sets /data).
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = projectRoot;

export const dataDir = process.env.MEDIATROVE_DATA_DIR ?? join(root, "_private", "data");
export const appDist = join(root, "app", "dist");

export function ensureDataDir() {
  mkdirSync(dataDir, { recursive: true });
}
