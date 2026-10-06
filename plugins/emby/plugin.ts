// Emby: reads played and in-progress movies and episodes. Shared code: ../_mediabrowser/client.ts

import { type Creds, connect, manifestFor, sync } from "../_mediabrowser/client.ts";
import { definePlugin } from "../_sdk/index.ts";
import type { SnapshotCursor } from "../_sdk/snapshot.ts";

export const manifest = manifestFor("emby", "Emby", "https://emby.media");

export default definePlugin<Creds>({
  manifest,
  connect: (fields) => connect(fields, "Emby"),
  sync: (creds, cursor) => sync(creds, cursor as SnapshotCursor),
});
