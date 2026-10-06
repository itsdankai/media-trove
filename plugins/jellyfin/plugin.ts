// Jellyfin: reads played and in-progress movies and episodes, and (for connections kept in sync)
// marks them played or unplayed. Shared code: ../_mediabrowser/client.ts

import { type Creds, connect, manifestFor, push, sync } from "../_mediabrowser/client.ts";
import { definePlugin } from "../_sdk/index.ts";
import type { SnapshotCursor } from "../_sdk/snapshot.ts";

export const manifest = manifestFor("jellyfin", "Jellyfin", "https://jellyfin.org", true);

export default definePlugin<Creds>({
  manifest,
  connect: (fields) => connect(fields, "Jellyfin"),
  sync: (creds, cursor) => sync(creds, cursor as SnapshotCursor),
  push: (creds, items) => push(creds, items),
});
