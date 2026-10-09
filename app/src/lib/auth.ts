// Sign-in (phase 10): Better Auth's browser client, talking to /api/auth on the same server.
import { passkeyClient } from "@better-auth/passkey/client";
import { adminClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [
    twoFactorClient({
      onTwoFactorRedirect: () => {
        window.location.href = "/sign-in?step=code";
      },
    }),
    passkeyClient(),
    adminClient(),
  ],
});

/** What the sign-in page offers (server: accounts.publicConfig). */
export type AuthConfig = {
  firstRun: boolean;
  signups: "invite" | "open" | "closed";
  google: boolean;
  oidc: string | null;
  email: boolean;
};

export async function authConfig(): Promise<AuthConfig> {
  const res = await fetch("/api/auth-config");
  return res.json();
}

/** Better Auth answers { data, error }; this turns an error into a thrown one so react-query shows it. */
export async function must<T>(p: Promise<{ data: T; error: { message?: string; status?: number } | null }>) {
  const { data, error } = await p;
  if (error) throw new Error(error.message || `Request failed (${error.status ?? "?"})`);
  return data;
}
