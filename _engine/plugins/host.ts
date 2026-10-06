// Runs plugins outside the main process. Bundled plugins are launched as child processes on a
// free localhost port and restarted with backoff if they die; one crashing plugin can only take
// itself down. Plugins added by URL are services the user runs themselves; we only call them.
import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import type { Manifest } from "../../plugins/_sdk/index.ts";

export type CatalogEntry = {
  id: string;
  name: string;
  description: string;
  kinds: string[];
  tags: string[];
  author: string;
  bundled?: boolean;
  manifestUrl?: string;
};

export type PluginStatus = {
  state: "stopped" | "starting" | "running" | "disconnected";
  pid?: number;
  lastError?: string;
  since: number;
};

/** A plugin answered with a problem the user can fix (wrong password…). */
export class PluginUserError extends Error {}

export interface PluginHost {
  catalog(): Promise<CatalogEntry[]>;
  manifest(id: string): Promise<Manifest>;
  call<T>(id: string, path: "/connect" | "/sync" | "/push", body: unknown): Promise<T>;
  statuses(): Record<string, PluginStatus>;
  addCustom?(url: string): Promise<Manifest>;
}

type Proc = {
  child: ChildProcess | null;
  port: number;
  status: PluginStatus;
  restarts: number;
  timer?: NodeJS.Timeout;
  ready?: Promise<void>;
};

export class ProcessHost implements PluginHost {
  private procs = new Map<string, Proc>();
  private custom = new Map<string, string>(); // id -> base url
  private manifests = new Map<string, Manifest>();
  private catalogCache: { at: number; list: CatalogEntry[] } | null = null;

  constructor(
    private root: string, // project root (holds plugins/)
    private opts: { catalogUrl?: string; customUrls?: string[] } = {},
  ) {}

  async catalog() {
    if (this.catalogCache && Date.now() - this.catalogCache.at < 10 * 60_000) return this.catalogCache.list;
    let list: CatalogEntry[] | null = null;
    if (this.opts.catalogUrl) {
      try {
        const r = await fetch(this.opts.catalogUrl, { signal: AbortSignal.timeout(8000) });
        if (r.ok) list = ((await r.json()) as { plugins: CatalogEntry[] }).plugins;
      } catch {
        // offline or not published yet: fall back to the copy shipped with the app
      }
    }
    // The online catalog adds community plugins; plugins shipped with this build are always listed,
    // even before the online catalog knows about them.
    const shipped = (
      JSON.parse(readFileSync(join(this.root, "plugins", "catalog.json"), "utf8")) as { plugins: CatalogEntry[] }
    ).plugins;
    const remote = list ?? [];
    list = [...remote, ...shipped.filter((s) => !remote.some((r) => r.id === s.id))];
    // Only offer bundled plugins this build actually ships.
    list = list.filter((p) => !p.bundled || this.bundledFile(p.id));
    for (const url of this.opts.customUrls ?? []) await this.addCustom(url).catch(() => {});
    const custom = [...this.custom.keys()].map((id) => {
      const m = this.manifests.get(id) as Manifest;
      return {
        id,
        name: m.name,
        description: m.description,
        kinds: m.kinds,
        tags: ["community"],
        author: "Added by URL",
        manifestUrl: `${this.custom.get(id)}/manifest.json`,
      };
    });
    this.catalogCache = { at: Date.now(), list: [...list, ...custom] };
    return this.catalogCache.list;
  }

  async addCustom(url: string) {
    const base = url.replace(/\/manifest\.json$/, "").replace(/\/+$/, "");
    const m = (await (await fetch(`${base}/manifest.json`, { signal: AbortSignal.timeout(8000) })).json()) as Manifest;
    if (!m?.id || !m.connect || m.contract !== 1)
      throw new PluginUserError("That URL doesn't serve a MediaTrove plugin manifest.");
    // A plugin is found by its id, and connections send their credentials to whatever answers for
    // that id. So a URL can't claim an id that's already taken (security pass, 2026-10-06): otherwise
    // a manifest saying "stremio" would receive the stored Stremio session on the next sync.
    if (!/^[a-z0-9-]{1,40}$/.test(m.id)) throw new PluginUserError("That plugin's id isn't valid.");
    const taken = this.bundledFile(m.id) || (this.custom.has(m.id) && this.custom.get(m.id) !== base);
    if (taken) throw new PluginUserError(`A plugin called "${m.id}" is already installed.`);
    this.custom.set(m.id, base);
    this.manifests.set(m.id, m);
    this.catalogCache = null;
    return m;
  }

  private bundledFile(id: string) {
    if (!/^[a-z0-9-]+$/.test(id)) return null;
    const file = join(this.root, "plugins", id, "server.ts");
    try {
      readFileSync(file);
      return file;
    } catch {
      return null;
    }
  }

  private async base(id: string) {
    const custom = this.custom.get(id);
    if (custom) return custom;
    await this.ensure(id);
    return `http://127.0.0.1:${this.procs.get(id)?.port}`;
  }

  /** Starts a bundled plugin if it isn't running, and waits until it answers. */
  async ensure(id: string) {
    const p = this.procs.get(id);
    if (p?.status.state === "running") return;
    if (p?.ready) return p.ready;
    const file = this.bundledFile(id);
    if (!file) throw new PluginUserError(`Unknown plugin: ${id}`);
    const proc: Proc = p ?? { child: null, port: 0, restarts: 0, status: { state: "stopped", since: Date.now() } };
    this.procs.set(id, proc);
    proc.ready = this.launch(id, file, proc).finally(() => {
      proc.ready = undefined;
    });
    return proc.ready;
  }

  private async launch(id: string, file: string, proc: Proc) {
    clearTimeout(proc.timer);
    proc.port = await freePort();
    proc.status = { state: "starting", since: Date.now() };
    const child = spawn(process.execPath, ["--import", "tsx", file], {
      cwd: this.root,
      // Only what a plugin needs to run: not MediaTrove's keys (TMDB, MEDIATROVE_SECRET_KEY) or other secrets.
      env: { ...pluginEnv(), PORT: String(proc.port) },
      stdio: ["ignore", "inherit", "inherit"],
    });
    proc.child = child;
    child.on("exit", (code, signal) => {
      if (proc.child !== child) return;
      proc.child = null;
      proc.status = { state: "disconnected", lastError: `exited (${signal ?? code})`, since: Date.now() };
      // Restart with backoff: 3s, 6s, 12s … capped at 60s. Healthy for a minute resets it.
      const delay = Math.min(60_000, 3000 * 2 ** proc.restarts++);
      proc.timer = setTimeout(() => this.ensure(id).catch(() => {}), delay);
    });
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (!proc.child) throw new Error(`${id} plugin exited while starting`);
      try {
        const r = await fetch(`http://127.0.0.1:${proc.port}/manifest.json`, { signal: AbortSignal.timeout(1000) });
        if (r.ok) {
          this.manifests.set(id, (await r.json()) as Manifest);
          proc.status = { state: "running", pid: child.pid, since: Date.now() };
          setTimeout(() => {
            if (proc.child === child) proc.restarts = 0;
          }, 60_000).unref();
          return;
        }
      } catch {
        // not listening yet
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    child.kill();
    throw new Error(`${id} plugin didn't start within 20s`);
  }

  async manifest(id: string) {
    await this.base(id);
    const m = this.manifests.get(id);
    if (!m) throw new Error(`no manifest for ${id}`);
    return m;
  }

  async call<T>(id: string, path: "/connect" | "/sync" | "/push", body: unknown): Promise<T> {
    const base = await this.base(id);
    const r = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300_000),
    });
    const data = (await r.json().catch(() => ({}))) as { error?: string; user?: boolean };
    if (!r.ok) {
      if (data.user) throw new PluginUserError(data.error ?? "The plugin rejected that.");
      throw new Error(`${id} plugin: ${data.error ?? r.status}`);
    }
    return data as T;
  }

  statuses() {
    const out: Record<string, PluginStatus> = {};
    for (const [id, p] of this.procs) out[id] = p.status;
    for (const id of this.custom.keys()) out[id] = { state: "running", since: 0 };
    return out;
  }

  stopAll() {
    for (const p of this.procs.values()) {
      clearTimeout(p.timer);
      const c = p.child;
      p.child = null;
      c?.kill();
    }
  }
}

/** The environment bundled plugins get: system basics, locale and proxies, nothing secret. */
export function pluginEnv(env: NodeJS.ProcessEnv = process.env) {
  const keep =
    /^(PATH|PATHEXT|HOME|USERPROFILE|TEMP|TMP|TMPDIR|SYSTEMROOT|SystemRoot|COMSPEC|LANG|LC_ALL|TZ|NODE_ENV|NODE_OPTIONS|NODE_EXTRA_CA_CERTS|HTTPS?_PROXY|NO_PROXY|https?_proxy|no_proxy)$/;
  return Object.fromEntries(Object.entries(env).filter(([k]) => keep.test(k)));
}

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}
