import { createHmac } from "node:crypto";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { definePlugin } from "../plugins/_sdk/index.ts";
import { type Accounts, createAccounts, INVITE_DAYS, type Mailer } from "./accounts.ts";
import { openDb } from "./db.ts";
import { appendEvents } from "./events.ts";
import type { MediaInfo, MetadataProvider } from "./metadata/types.ts";
import type { PluginHost } from "./plugins/host.ts";
import { createRoot } from "./root.ts";
import { createWorkspaces, type Workspaces } from "./workspaces.ts";

const ORIGIN = "http://mt.test";
const matrix: MediaInfo = {
  key: "tmdb-movie-603",
  kind: "movie",
  title: "The Matrix",
  year: 1999,
  poster: null,
  overview: null,
  genres: ["Action"],
  extra: {},
};
const provider: MetadataProvider = {
  kinds: ["movie", "show", "audiobook"],
  search: async () => [],
  resolve: async (r) => (r.tmdb === 603 ? matrix.key : null),
  details: async (key) => {
    if (key !== matrix.key) throw new Error("unknown");
    return matrix;
  },
};

// A plugin that reports The Matrix as watched for whoever connects it.
function fakeHost(): PluginHost {
  const plugin = definePlugin<{ token: string }>({
    manifest: {
      contract: 1,
      id: "fake",
      name: "Fake Player",
      version: "1",
      description: "",
      kinds: ["movie"],
      connect: { fields: [] },
      sync: { intervalSeconds: 60 },
    },
    connect: async () => ({ account: { name: "tester" }, credentials: { token: "secret-token-A" } }),
    sync: async (_c: unknown, cursor: unknown) => ({
      events: cursor
        ? []
        : [{ media: { kind: "movie", tmdb: 603 }, kind: "watched", occurredAt: "2026-10-01T20:00:00Z" }],
      cursor: 1,
    }),
  });
  return {
    catalog: async () => [
      { id: "fake", name: "Fake Player", description: "", kinds: ["movie"], tags: [], author: "test", bundled: true },
    ],
    manifest: async () => (await (await plugin.request("/manifest.json")).json()) as never,
    statuses: () => ({ fake: { state: "running", since: 0 } }),
    addCustom: async () => {
      throw new Error("not in tests");
    },
    async call(_id, path, body) {
      const r = await plugin.request(path, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      });
      return (await r.json()) as never;
    },
  };
}

let dir: string;
let accounts: Accounts;
let workspaces: Workspaces;
let root: ReturnType<typeof createRoot>;
let clock: number;
let mails: { to: string; subject: string; text: string }[];

async function setup(env: Record<string, string> = {}, mail = true) {
  dir = mkdtempSync(join(tmpdir(), "mt-accounts-"));
  clock = Date.now();
  mails = [];
  const noNetwork = (async () => {
    throw new Error("no network in tests");
  }) as typeof fetch;
  const sendMail: Mailer | null = mail
    ? async (to, subject, text) => {
        mails.push({ to, subject, text });
      }
    : null;
  workspaces = createWorkspaces({
    dataDir: dir,
    providers: [provider],
    host: fakeHost(),
    key: Buffer.alloc(32, 7),
    fetchFn: noNetwork,
  });
  accounts = createAccounts({
    file: join(dir, "auth.db"),
    key: Buffer.alloc(32, 7),
    env: { MEDIATROVE_URL: ORIGIN, ...env },
    mail: sendMail,
    onFirstUser: (u) => workspaces.adoptLegacy(u.id),
    onDeleted: (u) => workspaces.remove(u.id),
    now: () => clock,
  });
  await accounts.migrate();
  root = createRoot({
    accounts,
    workspaces,
    mail: sendMail,
    legacyPassword: env.MEDIATROVE_PASSWORD,
    env: { MEDIATROVE_URL: ORIGIN },
  });
}

const req = (path: string, init: RequestInit & { cookie?: string } = {}) =>
  root.request(`${ORIGIN}${path}`, {
    ...init,
    headers: {
      origin: ORIGIN,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.cookie ? { cookie: init.cookie } : {}),
      ...(init.headers as Record<string, string>),
    },
  });

const cookieOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

async function signUp(email: string, password = "correct horse battery", headers: Record<string, string> = {}) {
  const res = await req("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password, name: email.split("@")[0] }),
    headers,
  });
  const body = (await res.json().catch(() => ({}))) as { user?: { id: string }; message?: string };
  return { res, cookie: cookieOf(res), body };
}

async function signIn(email: string, password = "correct horse battery") {
  const res = await req("/api/auth/sign-in/email", { method: "POST", body: JSON.stringify({ email, password }) });
  return { res, cookie: cookieOf(res) };
}

async function invite(adminCookie: string, email: string) {
  const res = await req("/api/admin/invites", { method: "POST", cookie: adminCookie, body: JSON.stringify({ email }) });
  return (await res.json()) as { link: string; emailed: boolean };
}

afterEach(() => {
  workspaces.stopAll();
  accounts.close();
});

describe("sign-up rules", () => {
  beforeEach(() => setup());

  it("makes the first account the admin and then wants an invite", async () => {
    const admin = await signUp("admin@mt.test");
    expect(admin.res.status).toBe(200);
    expect(accounts.users()[0].role).toBe("admin");

    const stranger = await signUp("stranger@mt.test");
    expect(stranger.res.status).toBe(403);
    expect(stranger.body.message).toMatch(/invite-only/);
  });

  it("lets an invited email join once, and only within 7 days", async () => {
    const admin = await signUp("admin@mt.test");
    const { link, emailed } = await invite(admin.cookie, "friend@mt.test");
    expect(link).toMatch(new RegExp(`^${ORIGIN}/join/[\\w-]+$`));
    expect(emailed).toBe(true);
    expect(mails.at(-1)?.text).toContain(link);
    const token = link.split("/").at(-1) as string;
    expect((await req(`/api/invites/${token}`)).status).toBe(200);

    expect((await signUp("someone-else@mt.test")).res.status).toBe(403); // the invite is for one address
    expect((await signUp("friend@mt.test")).res.status).toBe(200);
    expect((await req(`/api/invites/${token}`)).status).toBe(404); // used

    const late = await invite(admin.cookie, "late@mt.test");
    clock += INVITE_DAYS * 24 * 60 * 60 * 1000 + 1;
    expect((await req(`/api/invites/${late.link.split("/").at(-1)}`)).status).toBe(404);
    expect((await signUp("late@mt.test")).res.status).toBe(403);
  });

  it("lets anyone who opened a group link join, until it's cancelled or 7 days pass (2026-10-09)", async () => {
    const admin = await signUp("admin@mt.test");
    const made = await req("/api/admin/invites", { method: "POST", cookie: admin.cookie, body: "{}" });
    expect(made.status).toBe(201);
    const { link, emailed } = (await made.json()) as { link: string; emailed: boolean };
    expect(emailed).toBe(false);
    const token = link.split("/").at(-1) as string;

    expect((await signUp("no-link@mt.test")).res.status).toBe(403); // never opened the link
    const opened = await req(`/api/invites/${token}`);
    expect(await opened.json()).toEqual({ email: null });
    const groupCookie = cookieOf(opened);
    expect(groupCookie).toMatch(/^mt_invite=/);
    expect((await signUp("one@mt.test", undefined, { cookie: groupCookie })).res.status).toBe(200);
    expect((await signUp("two@mt.test", undefined, { cookie: groupCookie })).res.status).toBe(200);
    const people = (await (await req("/api/admin/people", { cookie: admin.cookie })).json()) as {
      invites: { token: string; email: string; uses: number }[];
    };
    expect(people.invites).toEqual([expect.objectContaining({ token, email: "", uses: 2 })]);

    // Cancelled: the link and the cookie stop working at once.
    await req(`/api/admin/invites/${token}`, { method: "DELETE", cookie: admin.cookie });
    expect((await req(`/api/invites/${token}`)).status).toBe(404);
    expect((await signUp("three@mt.test", undefined, { cookie: groupCookie })).res.status).toBe(403);

    // Expired after 7 days.
    const late = (await (
      await req("/api/admin/invites", { method: "POST", cookie: admin.cookie, body: "{}" })
    ).json()) as { link: string };
    const lateToken = late.link.split("/").at(-1) as string;
    const lateCookie = cookieOf(await req(`/api/invites/${lateToken}`));
    clock += INVITE_DAYS * 24 * 60 * 60 * 1000 + 1;
    expect((await req(`/api/invites/${lateToken}`)).status).toBe(404);
    expect((await signUp("four@mt.test", undefined, { cookie: lateCookie })).res.status).toBe(403);
    expect(accounts.users()).toHaveLength(3);
  });

  it("follows MEDIATROVE_SIGNUPS", async () => {
    workspaces.stopAll();
    accounts.close();
    await setup({ MEDIATROVE_SIGNUPS: "open" });
    await signUp("admin@mt.test");
    expect((await signUp("anyone@mt.test")).res.status).toBe(200);

    workspaces.stopAll();
    accounts.close();
    await setup({ MEDIATROVE_SIGNUPS: "closed" });
    expect((await signUp("admin@mt.test")).res.status).toBe(200); // the first account is always allowed
    const admin = await signIn("admin@mt.test");
    await invite(admin.cookie, "friend@mt.test");
    expect((await signUp("friend@mt.test")).res.status).toBe(403);
  });

  it("only lets the admin manage people and add plugins by address", async () => {
    const admin = await signUp("admin@mt.test");
    await invite(admin.cookie, "friend@mt.test");
    const friend = await signUp("friend@mt.test");
    expect((await req("/api/admin/people", { cookie: friend.cookie })).status).toBe(403);
    expect(
      (await req("/api/admin/invites", { method: "POST", cookie: friend.cookie, body: '{"email":"x@mt.test"}' }))
        .status,
    ).toBe(403);
    const custom = await req("/api/marketplace/custom", {
      method: "POST",
      cookie: friend.cookie,
      body: JSON.stringify({ url: "http://example.test/manifest.json" }),
    });
    expect(custom.status).toBe(403);
    const people = (await (await req("/api/admin/people", { cookie: admin.cookie })).json()) as { people: unknown[] };
    expect(people.people).toHaveLength(2);
  });
});

describe("upgrading from before accounts", () => {
  it("keeps the old password until the first account exists, then gives that account the old library", async () => {
    dir = mkdtempSync(join(tmpdir(), "mt-legacy-"));
    const old = openDb(join(dir, "mediatrove.db"));
    appendEvents(old, [
      { mediaKey: matrix.key, kind: "watched", source: "manual", occurredAt: "2026-01-01T00:00:00Z" },
    ]);
    old.$client.close();
    workspaces = createWorkspaces({ dataDir: dir, providers: [provider], host: fakeHost(), key: Buffer.alloc(32, 7) });
    accounts = createAccounts({
      file: join(dir, "auth.db"),
      key: Buffer.alloc(32, 7),
      env: { MEDIATROVE_URL: ORIGIN },
      onFirstUser: (u) => workspaces.adoptLegacy(u.id),
    });
    await accounts.migrate();
    root = createRoot({ accounts, workspaces, legacyPassword: "hunter22", env: { MEDIATROVE_URL: ORIGIN } });

    expect((await signUp("admin@mt.test")).res.status).toBe(401); // a stranger can't claim the server
    const basic = { authorization: `Basic ${Buffer.from("x:hunter22").toString("base64")}` };
    const admin = await signUp("admin@mt.test", "correct horse battery", basic);
    expect(admin.res.status).toBe(200);
    expect(existsSync(join(dir, "mediatrove.db"))).toBe(false);
    const history = await req("/api/history", { cookie: admin.cookie });
    expect(await history.text()).toContain(matrix.key);
    // With an account in place the old password no longer matters; the session does.
    expect((await req("/api/history")).status).toBe(401);
  });
});

describe("each person's library is their own", () => {
  beforeEach(() => setup());

  it("answers 401 everywhere without a session", async () => {
    await signUp("admin@mt.test");
    const routes = workspaces.get(accounts.users()[0].id).app.routes.filter((r) => r.path.startsWith("/api/"));
    expect(routes.length).toBeGreaterThan(25);
    for (const r of routes) {
      if (r.method === "ALL" || r.path === "/api/health") continue;
      const path = r.path.replace(/:[a-z]+/g, "x");
      const res = await req(path, { method: r.method });
      expect(res.status, `${r.method} ${r.path}`).toBe(401);
    }
  });

  it("never shows or changes person A's things when person B calls every route", async () => {
    const a = await signUp("alice@mt.test");
    await invite(a.cookie, "bob@mt.test");
    const b = await signUp("bob@mt.test");

    // Alice: a manual watch, a watchlist entry, a connected app that synced, and a setting.
    expect(
      (
        await req("/api/events", {
          method: "POST",
          cookie: a.cookie,
          body: JSON.stringify({ mediaKey: matrix.key, kind: "watched" }),
        })
      ).status,
    ).toBeLessThan(300);
    await req(`/api/watchlist/${matrix.key}`, { method: "PUT", cookie: a.cookie });
    const conn = await req("/api/connections", {
      method: "POST",
      cookie: a.cookie,
      body: JSON.stringify({ pluginId: "fake", fields: {}, syncMode: "off" }),
    });
    const connId = ((await conn.json()) as { id: string }).id;
    await req("/api/settings", { method: "PUT", cookie: a.cookie, body: JSON.stringify({ theme: "alicetheme" }) });
    const before = await (await req("/api/connections", { cookie: a.cookie })).text();
    const aliceHistory = await (await req("/api/history", { cookie: a.cookie })).text();
    expect(aliceHistory).toContain("The Matrix");
    expect(before).toContain(connId);
    // Alice's app synced into Alice's library: History credits it.
    expect(aliceHistory).toContain('"source":"fake"');

    // Bob calls every route, GET and otherwise, with Alice's ids filled in.
    const routes = workspaces
      .get(accounts.users()[1].id)
      .app.routes.filter((r) => r.path.startsWith("/api/") && r.method !== "ALL");
    const fill = (p: string) =>
      p
        .replace(":key", matrix.key)
        .replace(":id", connId)
        .replace(":file", "0123456789abcdef0123.jpg")
        .replace(":source", "trakt")
        .replace(":code", "x")
        .replace(":n", "1");
    // The Matrix's own details are public; what Alice did with it is not.
    const leaks = [connId, "alicetheme", "secret-token-A", "alice@mt.test", '"watchlisted":true', '"watchCount":1'];
    for (const r of routes) {
      const body = r.method === "GET" ? undefined : "{}";
      const res = await req(fill(r.path), { method: r.method, cookie: b.cookie, body });
      if (r.method !== "GET") continue;
      const text = await res.text();
      for (const leak of leaks) expect(text, `${r.method} ${r.path} showed ${leak}`).not.toContain(leak);
    }

    for (const page of ["/api/history", "/api/library?kind=movie", "/api/watchlist"])
      expect(await (await req(page, { cookie: b.cookie })).text(), page).not.toContain("The Matrix");
    // Bob's own lookup cached the film's public details; his backup holds none of Alice's watches.
    const bobBackup = (await (await req("/api/backup", { cookie: b.cookie })).json()) as {
      events: unknown[];
      connections?: unknown;
    };
    expect(bobBackup.events).toEqual([]);

    // Alice's things are all still there.
    expect(await (await req("/api/connections", { cookie: a.cookie })).text()).toContain(connId);
    expect(await (await req("/api/history", { cookie: a.cookie })).text()).toContain("The Matrix");
    expect(await (await req("/api/settings", { cookie: a.cookie })).text()).toContain("alicetheme");
  });

  it("exports and deletes only your own account", async () => {
    const a = await signUp("alice@mt.test");
    await invite(a.cookie, "bob@mt.test");
    const b = await signUp("bob@mt.test");
    await req("/api/events", {
      method: "POST",
      cookie: b.cookie,
      body: JSON.stringify({ mediaKey: matrix.key, kind: "watched" }),
    });
    const exported = await req("/api/backup", { cookie: b.cookie });
    expect(exported.headers.get("content-disposition")).toMatch(/attachment/);
    expect(await exported.text()).toContain(matrix.key);

    const bobId = accounts.users()[1].id;
    const bobDir = join(dir, "users", bobId);
    expect(existsSync(bobDir)).toBe(true);
    const del = await req("/api/auth/delete-user", {
      method: "POST",
      cookie: b.cookie,
      body: JSON.stringify({ password: "correct horse battery" }),
    });
    expect(del.status).toBe(200);
    expect(existsSync(bobDir)).toBe(false);
    expect((await signIn("bob@mt.test")).res.status).toBe(401);
    expect(accounts.users().map((u) => u.email)).toEqual(["alice@mt.test"]);
  });
});

// RFC 6238 code from an otpauth:// address, as an authenticator app would make it.
function totp(uri: string, at = Date.now()) {
  const secret = new URL(uri).searchParams.get("secret") as string;
  let bits = "";
  for (const ch of secret.replace(/=+$/, ""))
    bits += "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)?.map((b) => Number.parseInt(b, 2)) ?? []);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

describe("two-factor", () => {
  it("asks for the authenticator code after it's turned on, and refuses a wrong one", async () => {
    await setup();
    const a = await signUp("alice@mt.test");
    const on = await req("/api/auth/two-factor/enable", {
      method: "POST",
      cookie: a.cookie,
      body: JSON.stringify({ password: "correct horse battery" }),
    });
    const { totpURI } = (await on.json()) as { totpURI: string };
    expect(totpURI).toMatch(/^otpauth:\/\/totp\/MediaTrove/);
    const confirm = await req("/api/auth/two-factor/verify-totp", {
      method: "POST",
      cookie: a.cookie,
      body: JSON.stringify({ code: totp(totpURI) }),
    });
    expect(confirm.status).toBe(200);

    const first = await signIn("alice@mt.test");
    expect(await first.res.json()).toMatchObject({ twoFactorRedirect: true });
    expect((await req("/api/history", { cookie: first.cookie })).status).toBe(401); // not signed in yet
    const wrong = await req("/api/auth/two-factor/verify-totp", {
      method: "POST",
      cookie: first.cookie,
      body: '{"code":"000000"}',
    });
    expect(wrong.status).toBe(401);
    const right = await req("/api/auth/two-factor/verify-totp", {
      method: "POST",
      cookie: first.cookie,
      body: JSON.stringify({ code: totp(totpURI) }),
    });
    expect(right.status).toBe(200);
    expect((await req("/api/history", { cookie: cookieOf(right) })).status).toBe(200);
  });
});

describe("other ways to sign in", () => {
  it("offers Google and OIDC only when they're set up, and sends the browser to them", async () => {
    await setup();
    expect(accounts.publicConfig()).toMatchObject({ google: false, oidc: null });
    workspaces.stopAll();
    accounts.close();

    // A stand-in OIDC server: just enough discovery document for Better Auth to build the redirect.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith("https://login.example.test/")
        ? Response.json({
            issuer: "https://login.example.test",
            authorization_endpoint: "https://login.example.test/authorize",
            token_endpoint: "https://login.example.test/token",
            userinfo_endpoint: "https://login.example.test/userinfo",
            jwks_uri: "https://login.example.test/jwks",
          })
        : realFetch(input, init)) as typeof fetch;
    try {
      await setup({
        GOOGLE_CLIENT_ID: "g-id",
        GOOGLE_CLIENT_SECRET: "g-secret",
        OIDC_DISCOVERY_URL: "https://login.example.test/.well-known/openid-configuration",
        OIDC_CLIENT_ID: "o-id",
        OIDC_CLIENT_SECRET: "o-secret",
        OIDC_NAME: "Authentik",
      });
      expect(accounts.publicConfig()).toMatchObject({ google: true, oidc: "Authentik" });
      for (const [provider, host] of [
        ["google", "accounts.google.com"],
        ["oidc", "login.example.test"],
      ]) {
        const res = await req("/api/auth/sign-in/social", {
          method: "POST",
          body: JSON.stringify({ provider, callbackURL: "/" }),
        });
        const { url } = (await res.json()) as { url: string };
        expect(new URL(url).host, provider).toBe(host);
      }
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("password reset", () => {
  it("emails the link when email is set up", async () => {
    await setup();
    await signUp("alice@mt.test");
    const res = await req("/api/auth/request-password-reset", {
      method: "POST",
      body: JSON.stringify({ email: "alice@mt.test", redirectTo: `${ORIGIN}/reset-password` }),
    });
    expect(res.status).toBe(200);
    const link = mails.at(-1)?.text.match(/https?:\/\/\S+/)?.[0] as string;
    expect(link).toBeTruthy();
    const token = new URL(link).pathname.split("/").at(-1) as string;
    const reset = await req("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, newPassword: "a brand new password" }),
    });
    expect(reset.status).toBe(200);
    expect((await signIn("alice@mt.test", "a brand new password")).res.status).toBe(200);
    expect((await signIn("alice@mt.test")).res.status).toBe(401);
  });

  it("gives the admin a reset link when there's no email", async () => {
    await setup({}, false);
    const admin = await signUp("admin@mt.test");
    await invite(admin.cookie, "bob@mt.test");
    await signUp("bob@mt.test");
    const bob = accounts.users()[1];
    const res = await req(`/api/admin/people/${bob.id}/reset-link`, { method: "POST", cookie: admin.cookie });
    expect(res.status).toBe(200);
    const { link } = (await res.json()) as { link: string };
    const followed = await req(new URL(link).pathname + new URL(link).search, { redirect: "manual" });
    const token = new URL(followed.headers.get("location") as string, ORIGIN).searchParams.get("token") as string;
    expect(token).toBeTruthy();
    const reset = await req("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, newPassword: "bobs new password" }),
    });
    expect(reset.status).toBe(200);
    expect((await signIn("bob@mt.test", "bobs new password")).res.status).toBe(200);
  });
});
