# Stremio plugin

Reads your Stremio library: movies you've watched, episodes you've watched, and where you stopped.

- **Connect with:** Stremio email and password (exchanged once for a session key; the password is
  not stored). Accounts that sign in with Facebook or Apple need to set a Stremio password first.
- **Reads** with `login` and `datastoreGet` on api.strem.io, and Cinemeta for episode lists.
- **Keeping Stremio in sync** (only if you choose it when connecting or in Settings): marks movies and
  episodes watched with `datastorePut`, the way Stremio's own apps do (stremio-core's `mark_as_watched`
  and `mark_video_as_watched`). Only titles already in your Stremio data are changed; MediaTrove never
  creates library entries. The episode bitfield is written in Stremio's own format, checked to
  round-trip on a real library of 105 shows before anything was written.
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
