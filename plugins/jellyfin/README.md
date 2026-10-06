# Jellyfin plugin

Reads played and in-progress movies and episodes from Jellyfin.

- **Connect with:** server address, username and password (exchanged once for an access token; the password isn't stored).
- **Reads** with POST /Users/AuthenticateByName, GET /Users/{id}/Items, GET /Shows/{id}/Episodes and GET /System/Info/Public.
- **Keeping Jellyfin in sync** (only if you choose it): the only writes allowed are POST and DELETE
  /Users/{id}/PlayedItems/{itemId} (mark played / unplayed). Anything else is refused in code before it is sent.
- **How it syncs:** every 3 minutes it compares what the server says is played with last time; new plays become "watched", positions become progress, and anything unplayed again becomes an unmark (applied only if the connection follows unmarks).
- **Matching:** by the TMDB, IMDb or TVDB ids the server attached, or by title and year when it has none.

## What was consulted

The Jellyfin API (OpenAPI spec published with every server) and a throwaway Jellyfin 12.2 test server.

No code was copied from CrossWatch, Yamtrack or any other project.
