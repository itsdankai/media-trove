# Nuvio plugin

Reads watched items and resume positions from a Nuvio Sync account (the official api.nuvio.tv or a
self-hosted Nuvio server).

- **Connect with:** Nuvio email and password (exchanged once for a session; the password is not
  stored), the profile number (1 is the main profile), and the server if you self-host.
- **Discovery:** the plugin reads the server's public client settings from `/.well-known/nuvio`, so
  only the server address is needed.
- **Reads** with `sync_pull_watched_items`, `sync_pull_watch_progress` and `sync_pull_profiles`.
- **Keeping Nuvio in sync** (only if you choose it): `sync_push_watched_items` to mark and
  `sync_delete_watched_items` to unmark, the same rows the Nuvio apps write, labelled with origin
  `mediatrove`. Every other function is refused in code.
- **Matching:** items keyed by IMDb id (`tt…`) are matched through TMDB. Other ids (Kitsu, etc.) are
  skipped for now and counted as "couldn't be matched".
- **Risk:** Nuvio's sync functions aren't a published API. If Nuvio changes them, this plugin needs updating.

## What was consulted

- `NuvioMedia/self-host` (GPL-3.0): `docs/client-configuration.md` and the database schema, to learn
  the table columns and function names.
- `NuvioMedia/NuvioTVSmart` (GPL-3.0): `js/core/auth/authManager.js`, to learn the sign-in endpoints.
- `https://api.nuvio.tv/.well-known/nuvio`, the official server's public settings.

Those files were read to understand the API. None of their code was copied.
