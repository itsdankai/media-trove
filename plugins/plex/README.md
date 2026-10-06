# Plex plugin

Reads played and in-progress movies and episodes from Plex.

- **Connect with:** server address plus a Plex token, or a plex.tv sign-in exchanged once for a token. Servers that allow your network without sign-in need only the address.
- **Read-only:** only GET /identity, GET /library/sections, GET /library/sections/{id}/all. Anything else is refused in code before it is sent.
- **How it syncs:** every 3 minutes it compares what the server says is played with last time; new plays become "watched", positions become progress, and anything unplayed again becomes an unmark (applied only if the connection follows unmarks).
- **Matching:** by the TMDB, IMDb or TVDB ids the server attached, or by title and year when it has none.

## What was consulted

Plex's public API reference and a throwaway Plex Media Server 1.43 test server (unclaimed).

No code was copied from CrossWatch, Yamtrack or any other project.
