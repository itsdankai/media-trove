# Writing a MediaTrove plugin

A plugin connects MediaTrove to one outside service, such as a media player, a server or a tracker.
It's a small HTTP service with three routes. MediaTrove calls it. The plugin never calls MediaTrove.

```
GET  /manifest.json   who you are, and the fields your connect form needs
POST /connect         { fields }               -> { account, credentials }
POST /sync            { credentials, cursor }  -> { events, cursor, credentials? }
```

**Plugins are stateless.** MediaTrove stores the `credentials` you return (encrypted) and the
`cursor`, and sends both back on every sync. Store tokens in `credentials`, never the password the
user typed. Return the password-free tokens and let the password go.

**Plugins only report what happened.** MediaTrove applies the sync rules: episodes from every source
are combined; the latest progress wins; reaching the user's watched threshold marks something watched;
and only the user can unmark. Don't try to apply those rules yourself.

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

- `kind` is `watched`, `progress` (with `progress` from 0 to 1) or `finished` (audiobooks).
- `media` takes every id you have: `tmdb`, `imdb`, `tvdb`, `asin`, `isbn`, plus `title`, `year` and
  `author`. MediaTrove matches on the most specific one.
- `occurredAt` is when it happened in your service, not when you synced. That's how MediaTrove orders
  reports from different apps.
- Sending the same event twice is harmless: MediaTrove recognises it and stores it once. Still, use the
  cursor so you don't resend your whole history every sync.

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
