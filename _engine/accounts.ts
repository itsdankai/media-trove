// Accounts (phase 10): sign-in for several people on one server, each with their own library.
// Better Auth does the logins (email + password, passkeys, two-factor, Google, any OIDC server) and keeps them
// in <data>/auth.db. Sign-up is by invite unless MEDIATROVE_SIGNUPS says otherwise; the very first account is
// the admin and takes over the library that existed before accounts.
import { createHmac, randomBytes } from "node:crypto";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { getMigrations } from "better-auth/db/migration";
import { admin } from "better-auth/plugins/admin";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { twoFactor } from "better-auth/plugins/two-factor";
import Database from "better-sqlite3";

export const INVITE_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;
export const signupModes = ["invite", "open", "closed"] as const;
export type SignupMode = (typeof signupModes)[number];

type Env = Record<string, string | undefined>;
export type Mailer = (
  to: string,
  subject: string,
  text: string,
  attachments?: { filename: string; content: string }[],
) => Promise<void>;
type User = { id: string; email: string; name: string; role?: string | null };

export type AccountsOptions = {
  file: string; // auth.db
  key: Buffer; // the server's secret key; the login secret is derived from it
  env?: Env;
  mail?: Mailer | null;
  /** The first account takes over the library from before accounts (workspaces.ts). */
  onFirstUser?: (user: User) => void;
  onDeleted?: (user: User) => void;
  now?: () => number;
};

export function createAccounts(opts: AccountsOptions) {
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now;
  const sqlite = new Database(opts.file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(`CREATE TABLE IF NOT EXISTS invites (
    token TEXT PRIMARY KEY, email TEXT NOT NULL, created_at INTEGER NOT NULL, used_at INTEGER)`);

  const mode: SignupMode = signupModes.find((m) => m === env.MEDIATROVE_SIGNUPS) ?? "invite";
  const google = env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET;
  const oidc = env.OIDC_DISCOVERY_URL && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET;
  const userCount = () => {
    try {
      return (sqlite.prepare("SELECT count(*) AS n FROM user").get() as { n: number }).n;
    } catch {
      return 0; // before the first migration
    }
  };
  const openInvite = (email: string) =>
    sqlite
      .prepare("SELECT token FROM invites WHERE email = ? AND used_at IS NULL AND created_at > ? LIMIT 1")
      .get(email.toLowerCase(), now() - INVITE_DAYS * DAY) as { token: string } | undefined;
  // Without email, password-reset links are handed to the admin instead of mailed (adminResetLink).
  const resetLinks = new Map<string, string>();

  const auth = betterAuth({
    database: sqlite,
    secret: env.BETTER_AUTH_SECRET ?? createHmac("sha256", opts.key).update("better-auth").digest("hex"),
    baseURL: env.MEDIATROVE_URL || undefined,
    telemetry: { enabled: false },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        if (!opts.mail) {
          resetLinks.set(user.email, url);
          return;
        }
        await opts.mail(
          user.email,
          "Reset your MediaTrove password",
          `Someone asked to reset the password for ${user.email}.\n\nSet a new one here (the link works for an hour):\n${url}\n\nIf it wasn't you, ignore this email.`,
        );
      },
    },
    socialProviders: google
      ? { google: { clientId: env.GOOGLE_CLIENT_ID as string, clientSecret: env.GOOGLE_CLIENT_SECRET as string } }
      : {},
    account: { accountLinking: { enabled: true } },
    user: {
      deleteUser: {
        enabled: true,
        afterDelete: async (user) => {
          sqlite.prepare("DELETE FROM invites WHERE email = ?").run(user.email.toLowerCase());
          opts.onDeleted?.(user);
        },
      },
    },
    plugins: [
      admin(),
      twoFactor({ issuer: "MediaTrove" }),
      passkey({ rpName: "MediaTrove" }),
      ...(oidc
        ? [
            genericOAuth({
              config: [
                {
                  providerId: "oidc",
                  discoveryUrl: env.OIDC_DISCOVERY_URL as string,
                  clientId: env.OIDC_CLIENT_ID as string,
                  clientSecret: env.OIDC_CLIENT_SECRET as string,
                  scopes: ["openid", "email", "profile"],
                },
              ],
            }),
          ]
        : []),
    ],
    databaseHooks: {
      user: {
        create: {
          // Every way of joining (password, Google, OIDC) creates a user here, so the invite rule lives here.
          before: async (user) => {
            if (userCount() === 0) return { data: { ...user, role: "admin" } };
            if (mode === "open") return { data: user };
            if (mode === "invite" && openInvite(user.email)) return { data: user };
            throw new APIError("FORBIDDEN", {
              message:
                mode === "closed"
                  ? "This server isn't taking new accounts."
                  : "This server is invite-only. Ask its owner for an invite to this email address.",
            });
          },
          after: async (user) => {
            if (userCount() === 1) opts.onFirstUser?.(user);
            sqlite
              .prepare("UPDATE invites SET used_at = ? WHERE email = ? AND used_at IS NULL")
              .run(now(), user.email.toLowerCase());
          },
        },
      },
    },
  });

  return {
    auth,
    mode,
    userCount,
    async migrate() {
      const { runMigrations } = await getMigrations(auth.options);
      await runMigrations();
    },
    /** What the sign-in page offers. */
    publicConfig: () => ({
      firstRun: userCount() === 0,
      signups: mode,
      google: Boolean(google),
      oidc: oidc ? env.OIDC_NAME || "Single sign-on" : null,
      email: Boolean(opts.mail),
    }),
    createInvite(email: string) {
      const token = randomBytes(18).toString("base64url");
      sqlite
        .prepare("INSERT INTO invites (token, email, created_at) VALUES (?, ?, ?)")
        .run(token, email.toLowerCase(), now());
      return token;
    },
    /** The invite behind a sign-up link, if it can still be used. */
    invite(token: string) {
      const row = sqlite.prepare("SELECT email, created_at, used_at FROM invites WHERE token = ?").get(token) as
        | { email: string; created_at: number; used_at: number | null }
        | undefined;
      if (!row || row.used_at || row.created_at <= now() - INVITE_DAYS * DAY) return null;
      return { email: row.email };
    },
    invites() {
      return sqlite
        .prepare(
          "SELECT token, email, created_at AS createdAt FROM invites WHERE used_at IS NULL AND created_at > ? ORDER BY created_at DESC",
        )
        .all(now() - INVITE_DAYS * DAY) as { token: string; email: string; createdAt: number }[];
    },
    revokeInvite(token: string) {
      sqlite.prepare("DELETE FROM invites WHERE token = ?").run(token);
    },
    users() {
      return sqlite.prepare("SELECT id, name, email, role, createdAt FROM user ORDER BY createdAt").all() as (User & {
        createdAt: string;
      })[];
    },
    /** A reset link for someone who forgot their password, when the server can't send email. */
    async adminResetLink(email: string, redirectTo: string) {
      resetLinks.delete(email);
      await auth.api.requestPasswordReset({ body: { email, redirectTo } });
      const url = resetLinks.get(email);
      resetLinks.delete(email);
      return url ?? null;
    },
    close: () => sqlite.close(),
  };
}

export type Accounts = ReturnType<typeof createAccounts>;
