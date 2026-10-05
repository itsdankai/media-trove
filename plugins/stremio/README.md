# Stremio plugin

Reads your Stremio library: movies you've watched, episodes you've watched, and where you stopped.

- **Connect with:** Stremio email and password (exchanged once for a session key; the password is
  not stored). Accounts that sign in with Facebook or Apple need to set a Stremio password first.
- **Read-only:** the plugin only calls `login` and `datastoreGet` on api.strem.io, and Cinemeta for episode lists.
- **How episodes are found:** Stremio stores watched episodes as a compressed bitfield, one bit per
  episode. The plugin decodes it against Cinemeta's episode list, sorted the way Stremio sorts it
  (season, then episode, then release date).
- **Counting:** Stremio keeps counts, not dated history. The plugin remembers what it has already
  reported, so each sync only adds what's new. A movie watched before you connected counts once.
- **Risk:** this is Stremio's private sync API. If Stremio changes it, this plugin needs updating.

## What was consulted

- `Stremio/stremio-core` (MIT): `src/types/library/library_item.rs` for library fields and episode order.
- `Stremio/stremio-watched-bitfield` (MIT): the bitfield format and anchor realignment.
- Stremio's API error responses, checked with a made-up email.

The decoder was written fresh from those descriptions. No code was copied from CrossWatch, Yamtrack
or any other AGPL project.
