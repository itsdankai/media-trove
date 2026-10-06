// Jellyfin: reads played and in-progress movies and episodes. Shared code: ../_mediabrowser/client.ts

import { type Creds, connect, manifestFor, sync } from "../_mediabrowser/client.ts";
import { definePlugin } from "../_sdk/index.ts";
import type { SnapshotCursor } from "../_sdk/snapshot.ts";

export const manifest = manifestFor("jellyfin", "Jellyfin", "https://jellyfin.org");

export default definePlugin<Creds>({
  manifest,
  connect: (fields) => connect(fields, "Jellyfin"),
  sync: (creds, cursor) => sync(creds, cursor as SnapshotCursor),
});
