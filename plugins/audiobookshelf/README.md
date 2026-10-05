# Audiobookshelf plugin

Reads your listening progress from an [Audiobookshelf](https://www.audiobookshelf.org) server.

- **Connect with:** server address plus username and password (exchanged once for a login token;
  the password is not stored), or an ABS API key made for a non-admin user.
- **Read-only:** the plugin can only call `POST /login`, `POST /auth/refresh`, `GET /api/me` and
  `GET /api/items/:id`. Any other request is refused in code before it's sent (see the tests in `plugins.test.ts`).
- **Matching:** books are matched to Audible by ASIN when the ABS item has one, otherwise by title and author.
- **Progress:** worked out from position ÷ length, because ABS's stored `progress` value can lag behind
  (seen on ABS 2.37.1).

## What was consulted

- The Audiobookshelf API docs (api.audiobookshelf.org) and the API key guide (audiobookshelf.org/guides/api-keys).
- A throwaway ABS 2.37.1 test server, to see the real login and progress responses.

No code was copied from CrossWatch, Yamtrack or any other project.
