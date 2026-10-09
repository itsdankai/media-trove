// The server's front door (phase 10): sign-in, the admin's People page, and handing every other /api request
// to the signed-in person's own library (workspaces.ts). Nothing under /api except health, the sign-in
// routes and an invite's email address answers without a session.
import { zValidator } from "@hono/zod-validator";
import { type Context, Hono } from "hono";
import { setCookie } from "hono/cookie";
import { z } from "zod";
import { type Accounts, GROUP_COOKIE, INVITE_DAYS, type Mailer } from "./accounts.ts";
import { passwordGate } from "./auth.ts";
import type { Workspaces } from "./workspaces.ts";

type User = { id: string; email: string; name: string; role?: string | null };
type Vars = { Variables: { user: User } };

/** The address people use to reach MediaTrove, for links in emails. MEDIATROVE_URL wins over the request. */
export function siteUrl(c: Context, env = process.env) {
  if (env.MEDIATROVE_URL) return env.MEDIATROVE_URL.replace(/\/$/, "");
  const url = new URL(c.req.url);
  const proto = c.req.header("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? url.host;
  return `${proto}://${host}`;
}

export function createRoot(opts: {
  accounts: Accounts;
  workspaces: Workspaces;
  mail?: Mailer | null;
  /** MEDIATROVE_PASSWORD from before accounts: still asked for until the first account exists. */
  legacyPassword?: string;
  env?: Record<string, string | undefined>;
}) {
  const { accounts, workspaces } = opts;
  const env = opts.env ?? process.env;
  const gate = passwordGate(opts.legacyPassword);
  const isAdmin = (c: Context<Vars>) => c.get("user").role === "admin";

  return (
    new Hono<Vars>()
      // An upgraded server stays behind its old password until someone has claimed it as admin.
      .use("*", async (c, next) => (accounts.userCount() === 0 ? gate(c, next) : next()))
      .get("/api/health", (c) => c.json({ ok: true }))
      .get("/api/auth-config", (c) => c.json(accounts.publicConfig()))
      // The sign-up page fills in the invited address. A group link has none; opening it remembers the link in a
      // cookie for the sign-up that follows (by password, Google or OIDC).
      .get("/api/invites/:token", (c) => {
        const token = c.req.param("token");
        const invite = accounts.invite(token);
        if (!invite) return c.json({ error: "This invite has been used, cancelled or has expired." }, 404);
        if (invite.email === null)
          setCookie(c, GROUP_COOKIE, token, {
            path: "/",
            httpOnly: true,
            sameSite: "Lax",
            maxAge: INVITE_DAYS * 86400,
          });
        return c.json(invite);
      })
      .on(["GET", "POST"], "/api/auth/*", (c) => accounts.auth.handler(c.req.raw))

      .use("/api/*", async (c, next) => {
        const session = await accounts.auth.api.getSession({ headers: c.req.raw.headers });
        if (!session) return c.json({ error: "Sign in first." }, 401);
        c.set("user", session.user as User);
        return next();
      })

      // --- the admin's People page -------------------------------------------------------------
      .use("/api/admin/*", async (c, next) =>
        isAdmin(c) ? next() : c.json({ error: "Only the admin can do that." }, 403),
      )
      .get("/api/admin/people", (c) => c.json({ people: accounts.users(), invites: accounts.invites() }))
      .post("/api/admin/invites", zValidator("json", z.object({ email: z.email().optional() })), async (c) => {
        const { email } = c.req.valid("json");
        // No email: one link for a group chat, good for 7 days and any number of people, until it's cancelled.
        if (!email) return c.json({ link: `${siteUrl(c, env)}/join/${accounts.createInvite()}`, emailed: false }, 201);
        if (accounts.users().some((u) => u.email.toLowerCase() === email.toLowerCase()))
          return c.json({ error: "That email already has an account." }, 409);
        const token = accounts.createInvite(email);
        const link = `${siteUrl(c, env)}/join/${token}`;
        let emailed = false;
        if (opts.mail) {
          const from = c.get("user").name || c.get("user").email;
          await opts.mail(
            email,
            "You're invited to MediaTrove",
            `${from} invited you to their MediaTrove, a tracker for what you watch and listen to.\n\nMake your account here (the link works for 7 days, once):\n${link}`,
          );
          emailed = true;
        }
        return c.json({ link, emailed }, 201);
      })
      .delete("/api/admin/invites/:token", (c) => {
        accounts.revokeInvite(c.req.param("token"));
        return c.json({ ok: true });
      })
      .post("/api/admin/people/:id/reset-link", async (c) => {
        const person = accounts.users().find((u) => u.id === c.req.param("id"));
        if (!person) return c.json({ error: "No such person." }, 404);
        const link = await accounts.adminResetLink(person.email, `${siteUrl(c, env)}/reset-password`);
        return link
          ? c.json({ link })
          : c.json({ error: "The reset email was sent to them instead (email is set up)." }, 409);
      })
      .delete("/api/admin/people/:id", async (c) => {
        const id = c.req.param("id");
        if (id === c.get("user").id) return c.json({ error: "Delete your own account from Settings." }, 400);
        await accounts.auth.api.removeUser({ body: { userId: id }, headers: c.req.raw.headers });
        workspaces.remove(id);
        return c.json({ ok: true });
      })

      // A plugin added by address shows up in everyone's marketplace, so only the admin adds them.
      .post("/api/marketplace/custom", async (c, next) =>
        isAdmin(c) ? next() : c.json({ error: "Only the admin can add plugins by address." }, 403),
      )

      // Everything else is the signed-in person's own library.
      .all("/api/*", (c) => workspaces.get(c.get("user").id).app.fetch(c.req.raw))
  );
}
