# Writing a MediaTrove plugin

A plugin connects MediaTrove to one outside service, such as a media player, a server or a tracker.
It's a small HTTP service with three routes, plus an optional fourth. MediaTrove calls it. The plugin
never calls MediaTrove.

```
GET  /manifest.json   who you are, and the fields your connect form needs
POST /connect         { fields }               -> { account, credentials }
POST /sync            { credentials, cursor }  -> { events, cursor, credentials? }
POST /push            { credentials, items }   -> { results }   optional: keep the app in sync
```

**Plugins are stateless.** MediaTrove stores the `credentials` you return (encrypted) and the
`cursor`, and sends both back on every sync. Store tokens in `credentials`, never the password the
user typed. Return the password-free tokens and let the password go.

**Plugins only report what happened.** MediaTrove applies the sync rules: episodes from every source
are combined; the latest progress wins; reaching the user's watched threshold marks something watched;
and the latest action wins, including unmarks. Don't try to apply those rules yourself.

## The manifest

```json
{
  "contract": 1,
  "id": "my-player",
  "name": "My Player",
  "version": "0.1.0",
  "description": "Track what you watch in My Player.",
  "kinds": ["movie", "show"],
  "connect": {
    "fields": [
      { "key": "server", "label": "Server address", "type": "url", "required": true },
      { "key": "token", "label": "API token", "type": "password", "required": true }
    ],
    "note": "Shown above the form."
  },
  "sync": { "intervalSeconds": 300 }
}
```

Field types are `text`, `url`, `password`, `number` and `email`. MediaTrove builds the connect form
from this list.

## Events

```json
{
  "media": { "kind": "show", "imdb": "tt11280740", "title": "Severance" },
  "kind": "watched",
  "season": 1,
  "episode": 3,
  "occurredAt": "2026-10-05T20:00:00.000Z"
}
```

- `kind` is `watched`, `progress` (with `progress` from 0 to 1), `finished` (audiobooks) or `unwatched`.
  Send `unwatched` when something was unmarked in your service. MediaTrove applies it only if the user
  lets that connection "follow unmarks" (on by default). The latest action wins: it clears earlier
  marks from every app, but never the user's own MediaTrove marks.
- Servers that only expose "what's played now" can use `plugins/_sdk/snapshot.ts`. It compares
  snapshots between syncs and produces the right `watched`, `unwatched` and `progress` events.
- `media` takes every id you have: `tmdb`, `imdb`, `tvdb`, `asin`, `isbn`, plus `title`, `year` and
  `author`. MediaTrove matches on the most specific one.
- `occurredAt` is when it happened in your service, not when you synced. That's how MediaTrove orders
  reports from different apps.
- Sending the same event twice is harmless: MediaTrove recognises it and stores it once. Still, use the
  cursor so you don't resend your whole history every sync.

## Keeping the app in sync (optional)

A plugin that can also change its app, marking things watched there, says so in its manifest:

```json
{ "capabilities": { "write": true } }
```

and serves one more route:

```
POST /push   { credentials, items }   -> { results, credentials? }
```

```json
{
  "items": [
    { "media": { "kind": "movie", "tmdb": 603, "imdb": "tt0133093", "title": "The Matrix", "year": 1999 },
      "action": "watched", "occurredAt": "2026-10-06T07:19:15.000Z" },
    { "media": { "kind": "show", "tmdb": 95396, "imdb": "tt11280740", "tvdb": 371980, "title": "Severance" },
      "action": "unwatched", "season": 1, "episode": 3, "occurredAt": "2026-10-06T08:00:00.000Z" }
  ]
}
```

Reply with one result per item, in the same order: `{ "ok": true }`, `{ "ok": false, "notFound": true }`
when the app doesn't have that title, or `{ "ok": false, "error": "…" }` for anything else (it's retried later).

MediaTrove decides what to send; the plugin only carries it out. MediaTrove calls `/push` only for
connections the user set to keep in sync, chosen when connecting:

- **Off:** never.
- **Add only** (the default): only `watched`. Nothing in the app is ever unmarked.
- **Full:** `unwatched` too, but only for unmarks made after the user chose Full.

The app's own marks always come in first: MediaTrove pushes only after a complete sync, and only when
its latest action on that movie or episode is newer than the app's. When the app reports a pushed mark
back on its next sync, MediaTrove counts it as the same viewing, not a second one.

Use `occurredAt` as the watched date where the app keeps one. Only make the requests a push needs:
the bundled media-server plugins check every request against an allowlist, and the only writes they
allow are "mark played" and "mark unplayed".

## Errors

Reply `400 { "error": "Wrong password.", "user": true }` for problems the user can fix. MediaTrove
shows that message in the connect form or next to the connection. Any other error is logged and shown
as a failed sync.

## TypeScript kit

The bundled plugins use `plugins/_sdk/index.ts`:

```ts
import { definePlugin, run } from "../_sdk/index.ts";

const plugin = definePlugin({
  manifest,
  async connect(fields) {
    return { account: { name: "me" }, credentials: { token: fields.token } };
  },
  async sync(credentials, cursor) {
    return { events: [], cursor };
  },
});
run(plugin); // listens on $PORT
```

Any language works, as long as it serves those three routes.

## Adding yours

- **Your own instance:** in the Marketplace, open "Add a plugin by URL" and paste your
  `https://…/manifest.json`. Or set `MEDIATROVE_PLUGIN_URLS` to a comma-separated list.
- **For everyone:** open a pull request that adds an entry to `plugins/catalog.json`.
