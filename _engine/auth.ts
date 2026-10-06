// Optional password for the whole app (security pass, 2026-10-06). Without it anyone who can reach
// the port can see the library and change connections, so set MEDIATROVE_PASSWORD whenever MediaTrove
// is reachable by more than you (your LAN, a reverse proxy, the internet). It's HTTP Basic auth: the
// browser asks once; any username works. Use HTTPS (a reverse proxy) if it leaves your own network.
import { createHash, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

const digest = (s: string) => createHash("sha256").update(s).digest();

export function passwordGate(password = process.env.MEDIATROVE_PASSWORD): MiddlewareHandler {
  if (!password) return async (_c, next) => next();
  const expected = digest(password);
  return async (c, next) => {
    if (c.req.path === "/api/health") return next(); // for container health checks
    const header = c.req.header("authorization") ?? "";
    const [scheme, encoded] = header.split(" ");
    if (scheme === "Basic" && encoded) {
      const decoded = Buffer.from(encoded, "base64").toString("utf8");
      const given = decoded.slice(decoded.indexOf(":") + 1);
      // Hash both sides so the comparison takes the same time whatever the length.
      if (timingSafeEqual(digest(given), expected)) return next();
    }
    return c.text("Password required", 401, { "WWW-Authenticate": 'Basic realm="MediaTrove", charset="UTF-8"' });
  };
}
