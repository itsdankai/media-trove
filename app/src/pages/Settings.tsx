import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { Download, RefreshCw, RotateCcw, Store, Unplug, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Account, People } from "@/components/AccountSettings";
import { Confirm } from "@/components/Confirm";
import { SyncModePicker } from "@/components/SyncModePicker";
import { ThresholdPicker } from "@/components/ThresholdPicker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  api,
  type Connection,
  type PluginStatus,
  type Settings as SettingsData,
  type SyncMode,
  timeAgo,
} from "@/lib/api";
import { authClient } from "@/lib/auth";
import { friendlyError } from "@/lib/errors";
import { applyLook, effects, fonts, type Look, themes } from "@/lib/themes";

export function Settings() {
  const qc = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const [params, setParams] = useSearchParams();
  const isAdmin = (authClient.useSession().data?.user as { role?: string } | undefined)?.role === "admin";
  const tabs = settingsTabs.filter((t) => t.id !== "people" || isAdmin);
  const tab = tabs.find((t) => t.id === params.get("tab"))?.id ?? "tracking";
  const [threshold, setThreshold] = useState(0.9);
  useEffect(() => {
    if (settings) setThreshold(settings.watchedThreshold);
  }, [settings]);
  const save = useMutation({
    mutationFn: () => api.saveSettings({ watchedThreshold: threshold }),
    onSuccess: (s) => {
      qc.setQueryData(["settings"], s);
      qc.invalidateQueries({ queryKey: ["library"] });
      qc.invalidateQueries({ queryKey: ["media"] });
    },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        {/* One section at a time, so the page doesn't grow into one long scroll (builder, 2026-10-08).
            The tab is in the URL (?tab=apps), so a link or Back lands on the same one. */}
        <Tabs value={tab} onValueChange={(v) => setParams(v === "tracking" ? {} : { tab: v }, { replace: true })}>
          {/* Six tabs (with People) are wider than a phone: let them wrap rather than scroll the page sideways. */}
          <TabsList className="max-w-full flex-wrap justify-start group-data-[orientation=horizontal]/tabs:h-auto">
            {tabs.map((t) => (
              <TabsTrigger key={t.id} value={t.id}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {tab === "tracking" && (
        <section className="space-y-4">
          <h2 className="text-lg font-medium">Tracking</h2>
          <Card className="gap-5 p-5">
            <ThresholdPicker value={threshold} onChange={setThreshold} />
            <div className="flex items-center gap-3">
              <Button
                onClick={() => save.mutate()}
                disabled={save.isPending || threshold === settings?.watchedThreshold}
              >
                Save
              </Button>
              {save.isSuccess && threshold === settings?.watchedThreshold && (
                <span className="text-sm text-muted-foreground">Saved. Your library was recalculated.</span>
              )}
            </div>
            {settings && <CaughtUpWindow days={settings.caughtUpDays} />}
          </Card>
        </section>
      )}

      {tab === "appearance" && settings && <Appearance settings={settings} />}

      {tab === "apps" && <Connections />}

      {tab === "backups" && <Backups />}
      {tab === "account" && <Account />}
      {tab === "people" && <People />}
    </div>
  );
}

const settingsTabs = [
  { id: "tracking", label: "Tracking" },
  { id: "appearance", label: "Appearance" },
  { id: "apps", label: "Plugins" },
  { id: "backups", label: "Backups" },
  { id: "account", label: "Account" },
  { id: "people", label: "People" }, // admin only
] as const;

const windows = [
  { days: 30, label: "30 days" },
  { days: 60, label: "60 days" },
  { days: 90, label: "90 days" },
  { days: 180, label: "6 months" },
  { days: 0, label: "Any time" },
];

/** How soon a show's next episode must air for it to read "Caught up" rather than Completed. Saves on change. */
function CaughtUpWindow({ days }: { days: number }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (d: number) => api.saveSettings({ caughtUpDays: d }),
    onSuccess: (s) => {
      qc.setQueryData(["settings"], s);
      qc.invalidateQueries({ queryKey: ["library"] });
      qc.invalidateQueries({ queryKey: ["media"] });
    },
  });
  return (
    <div className="space-y-2 border-t pt-4">
      <label htmlFor="caught-up" className="flex flex-wrap items-center gap-2 text-sm font-medium">
        Show "Caught up" when the next episode airs within
        <select
          id="caught-up"
          value={days}
          onChange={(e) => save.mutate(Number(e.target.value))}
          disabled={save.isPending}
          className="rounded-md border bg-card px-2 py-1 font-medium [&>option]:bg-card"
        >
          {windows.map((w) => (
            <option key={w.days} value={w.days}>
              {w.label}
            </option>
          ))}
        </select>
      </label>
      <p className="max-w-prose text-xs text-muted-foreground">
        When you've seen every aired episode. Further off than this (a new season next year), the show reads Completed
        until the date gets close.
      </p>
    </div>
  );
}

/** Theme, effects and rating posters (RPDB for movies and shows when the server has RPDB_API_KEY; the anime community score). */
function Appearance({ settings }: { settings: SettingsData }) {
  const qc = useQueryClient();
  const { data: config } = useQuery({ queryKey: ["config"], queryFn: api.config });
  const save = useMutation({
    mutationFn: (patch: Partial<SettingsData>) => api.saveSettings(patch),
    onSuccess: (s) => qc.setQueryData(["settings"], s),
  });
  // Show the change straight away; the server copy follows.
  const change = (patch: Partial<Look>) => {
    applyLook({ ...settings, ...patch });
    save.mutate(patch);
  };
  const toggle = (id: string, on: boolean) =>
    change({ effects: on ? [...settings.effects, id] : settings.effects.filter((e) => e !== id) });
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">Appearance</h2>
      <Card className="gap-6 p-5">
        <div className="space-y-3">
          <p className="text-sm font-medium">Theme</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {themes.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => change({ theme: t.id })}
                aria-pressed={settings.theme === t.id}
                // The preview carries the theme itself (and AMOLED), so it shows the real colours.
                data-theme={t.id}
                data-amoled={settings.amoled ? "" : undefined}
                className={cn(
                  t.id !== "daylight" && "dark",
                  "rounded-xl border bg-background p-3 text-left text-foreground transition-shadow",
                  settings.theme === t.id ? "ring-2 ring-primary" : "hover:ring-1 hover:ring-primary/50",
                )}
              >
                <div className="flex items-center gap-1.5">
                  <span className="size-4 rounded-full bg-primary" />
                  <span className="size-4 rounded-full" style={{ background: "var(--glow2)" }} />
                  <span className="size-4 rounded-full bg-card ring-1 ring-border" />
                </div>
                <p className="mt-2 text-sm font-medium">{t.name}</p>
                <p className="max-w-prose text-xs text-muted-foreground">{t.note}</p>
              </button>
            ))}
          </div>
          <label htmlFor="amoled" className="flex items-center gap-3 pt-2 text-sm">
            <Switch
              id="amoled"
              checked={settings.amoled}
              onCheckedChange={(on) => change({ amoled: on })}
              disabled={settings.theme === "daylight"}
              aria-label="AMOLED mode"
            />
            <span>
              AMOLED mode
              <span className="block max-w-prose text-xs text-muted-foreground">
                True black backgrounds: easier on OLED screens and their batteries. Works with every dark theme.
              </span>
            </span>
          </label>
        </div>
        <div className="space-y-3 border-t pt-5">
          <p className="text-sm font-medium">Font</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {fonts.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => change({ font: f.id })}
                aria-pressed={settings.font === f.id}
                title={f.note}
                className={cn(
                  "rounded-lg border bg-card px-3 py-2 text-left text-sm transition-shadow",
                  settings.font === f.id ? "ring-2 ring-primary" : "hover:ring-1 hover:ring-primary/50",
                )}
              >
                {f.name}
              </button>
            ))}
          </div>
          <p className="max-w-prose text-xs text-muted-foreground">
            {fonts.find((f) => f.id === settings.font)?.note} Fonts other than Inter and System load from Google Fonts.
          </p>
        </div>
        <div className="space-y-3 border-t pt-5">
          <p className="text-sm font-medium">Effects</p>
          {effects.map((e) => (
            <label key={e.id} htmlFor={`fx-${e.id}`} className="flex items-center gap-3 text-sm">
              <Switch
                id={`fx-${e.id}`}
                checked={settings.effects.includes(e.id)}
                onCheckedChange={(on) => toggle(e.id, on)}
                disabled={e.id === "motion" && !settings.effects.includes("ambient")}
                aria-label={e.name}
              />
              <span>
                {e.name}
                <span className="block max-w-prose text-xs text-muted-foreground">{e.note}</span>
              </span>
            </label>
          ))}
          <p className="max-w-prose text-xs text-muted-foreground">
            Movement is switched off if your device is set to reduce motion.
          </p>
        </div>
        <label htmlFor="rating-posters" className="flex items-center gap-3 border-t pt-5 text-sm">
          <Switch
            id="rating-posters"
            checked={settings.ratingPosters}
            onCheckedChange={(on) => save.mutate({ ratingPosters: on })}
            disabled={save.isPending}
            aria-label="Rating posters"
          />
          <span>
            Rating posters
            <span className="block max-w-prose text-xs text-muted-foreground">
              {config?.rpdb
                ? "Movies and shows use RPDB posters with IMDb and Rotten Tomatoes scores on them. "
                : "Movies and shows: add RPDB_API_KEY to the server's .env for posters with IMDb and Rotten Tomatoes scores. "}
              Anime shows its community score (MyAnimeList, AniList and others).
            </span>
          </span>
        </label>
      </Card>
    </section>
  );
}

/** Download the whole library as one file, see the latest weekly backup, restore from a file. */
function Backups() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["backup-status"], queryFn: api.backupStatus });
  const [file, setFile] = useState<File | null>(null);
  const restore = useMutation({
    mutationFn: () => api.restoreBackup(file as File),
    onSuccess: () => qc.invalidateQueries(),
  });
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">Backups</h2>
      <Card className="gap-4 p-5 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground">
            Everything you've tracked, as one file. Connections aren't included: reconnect your apps after a restore.
          </p>
          <Button asChild variant="secondary" size="sm">
            <a href="/api/backup" download>
              <Download /> Download backup
            </a>
          </Button>
        </div>
        <p className="text-muted-foreground">
          {data?.latest
            ? `A backup is also saved automatically every week, in the data folder's "backups" folder (the last 8 are kept). Latest: ${data.latest.file}, ${timeAgo(data.latest.at)}.`
            : `A backup is also saved automatically every week, in the data folder's "backups" folder (the last 8 are kept).`}
        </p>
        <form
          className="flex flex-wrap items-center gap-2 border-t pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (confirm("Add everything in this backup to your library? Nothing you have now is removed."))
              restore.mutate();
          }}
        >
          <label htmlFor="restore-file" className="font-medium">
            Restore
          </label>
          <Input
            id="restore-file"
            type="file"
            accept=".json"
            className="max-w-xs"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <Button type="submit" size="sm" variant="outline" disabled={!file || restore.isPending}>
            <Upload /> Restore
          </Button>
          {restore.error && <p className="w-full text-destructive">{friendlyError(restore.error)}</p>}
          {restore.data && (
            <p className="w-full text-muted-foreground">
              {restore.data.added
                ? `Restored ${restore.data.added} entries across ${restore.data.titles} titles.`
                : "Nothing new: everything in that backup is already here."}
            </p>
          )}
        </form>
      </Card>
    </section>
  );
}

function Connections() {
  const qc = useQueryClient();
  const { data: conns = [] } = useQuery({ queryKey: ["connections"], queryFn: api.connections, refetchInterval: 5000 });
  const { data: statuses = {} } = useQuery({
    queryKey: ["plugin-statuses"],
    queryFn: api.pluginStatuses,
    refetchInterval: 2000,
  });
  const { data: catalog = [] } = useQuery({ queryKey: ["marketplace", ""], queryFn: () => api.marketplace() });
  const name = (id: string) => catalog.find((p) => p.id === id)?.name ?? id;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["connections"] });
    qc.invalidateQueries({ queryKey: ["history"] });
    qc.invalidateQueries({ queryKey: ["library"] });
  };
  const sync = useMutation({ mutationFn: api.syncNow, onSettled: refresh });
  const resync = useMutation({ mutationFn: api.resync, onSettled: refresh });
  const follow = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => api.setFollowUnmarks(id, on),
    onSettled: refresh,
  });
  const remove = useMutation({ mutationFn: api.disconnect, onSettled: refresh });

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Connected plugins</h2>
        <Button asChild size="sm" variant="outline">
          <Link to="/marketplace">
            <Store /> Marketplace
          </Link>
        </Button>
      </div>
      {conns.length === 0 && (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          Nothing connected yet. Find your apps in the{" "}
          <Link to="/marketplace" className="text-primary hover:underline">
            marketplace
          </Link>
          .
        </p>
      )}
      <ul className="space-y-3">
        {conns.map((c) => (
          <li key={c.id}>
            <Card className="gap-3 p-4">
              <div className="flex flex-wrap items-center gap-3">
                {/* Phone: name and status fill the first row, the buttons wrap to the second. */}
                <div className="min-w-0 flex-1 basis-[calc(100%-7rem)] sm:basis-auto">
                  <p className="truncate font-medium">{name(c.pluginId)}</p>
                  <p className="truncate text-sm text-muted-foreground">{c.accountName}</p>
                </div>
                <StatusBadge status={statuses[c.pluginId]} />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => sync.mutate(c.id)}
                  disabled={c.syncing || sync.isPending}
                >
                  <RefreshCw className={c.syncing ? "animate-spin" : ""} /> Sync now
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => resync.mutate(c.id)}
                  disabled={c.syncing || resync.isPending}
                  title="Re-import everything from this app, using the latest matching. Your own entries are kept."
                >
                  <RotateCcw /> Start over
                </Button>
                <Confirm
                  title={`Disconnect ${name(c.pluginId)}?`}
                  description={`MediaTrove forgets the login for ${c.accountName} and stops syncing it. Everything it already brought in stays in your library. You can connect it again from the Marketplace.`}
                  action="Disconnect"
                  onConfirm={() => remove.mutate(c.id)}
                >
                  <Button size="sm" variant="ghost" aria-label={`Disconnect ${name(c.pluginId)}`}>
                    <Unplug />
                  </Button>
                </Confirm>
              </div>
              <SyncLine c={c} />
              <label htmlFor={`follow-${c.id}`} className="flex items-center gap-3 text-sm">
                <Switch
                  id={`follow-${c.id}`}
                  checked={c.followUnmarks}
                  onCheckedChange={(on) => follow.mutate({ id: c.id, on })}
                  aria-label={`Also remove things I unmark in ${name(c.pluginId)}`}
                />
                <span>
                  Also remove things I unmark in {name(c.pluginId)}
                  <span className="block max-w-prose text-xs text-muted-foreground">
                    Your latest action in any app wins. Marks you made yourself in MediaTrove are always kept.
                  </span>
                </span>
              </label>
              <KeepInSync c={c} app={name(c.pluginId)} onChanged={refresh} />
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The sync mode for apps that can be written to. Turning it on first shows what would be sent, so
 * nothing lands in the app by surprise; switching off, or between Add only and Full, applies at once.
 */
function KeepInSync({ c, app, onChanged }: { c: Connection; app: string; onChanged: () => void }) {
  const { data: manifest } = useQuery({ queryKey: ["manifest", c.pluginId], queryFn: () => api.manifest(c.pluginId) });
  const [pending, setPending] = useState<"add" | "full" | null>(null);
  const preview = useQuery({
    queryKey: ["push-preview", c.id, pending],
    queryFn: () => api.pushPreview(c.id, pending as "add" | "full"),
    enabled: pending !== null,
    staleTime: 0,
  });
  const set = useMutation({
    mutationFn: ({ m, fromNow = false }: { m: SyncMode; fromNow?: boolean }) => api.setSyncMode(c.id, m, fromNow),
    onSettled: () => {
      setPending(null);
      onChanged();
    },
  });
  if (!manifest?.capabilities?.write) return null;

  function choose(m: SyncMode) {
    if (m === c.syncMode) return;
    if (c.syncMode === "off" && m !== "off") setPending(m);
    else set.mutate({ m });
  }

  const p = preview.data;
  return (
    <div className="space-y-2 border-t pt-3">
      <SyncModePicker
        app={app}
        value={pending ?? (c.syncMode as SyncMode)}
        onChange={choose}
        disabled={set.isPending}
      />
      {pending && (
        <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
          {preview.isLoading && <p className="text-muted-foreground">Checking what would change in {app}…</p>}
          {preview.error && <p className="text-destructive">{friendlyError(preview.error)}</p>}
          {p && (
            <p>
              {p.watched === 0
                ? `${app} already has everything MediaTrove has. From now on, new marks will be added there.`
                : `This marks ${p.watched} movies and episodes watched in ${app}, across ${p.titles} titles${
                    p.sample.length ? ` (${p.sample.join(", ")}${p.titles > p.sample.length ? "…" : ""})` : ""
                  }. Titles ${app} doesn't have are skipped.`}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {p && p.watched > 0 ? (
              <>
                <Button size="sm" onClick={() => set.mutate({ m: pending })} disabled={set.isPending}>
                  Turn on and add these
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => set.mutate({ m: pending, fromNow: true })}
                  disabled={set.isPending}
                >
                  Only new marks from now on
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => set.mutate({ m: pending })} disabled={!p || set.isPending}>
                Turn on
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      <PushLine c={c} app={app} />
    </div>
  );
}

function PushLine({ c, app }: { c: Connection; app: string }) {
  const s = c.lastPushSummary;
  if (c.syncMode === "off") return null;
  if (c.pushing) return <p className="max-w-prose text-xs text-muted-foreground">Sending changes to {app}…</p>;
  if (!s) return <p className="max-w-prose text-xs text-muted-foreground">Changes go to {app} after the next sync.</p>;
  if (s.error)
    return (
      <p className="text-xs text-destructive">
        Couldn't update {app}: {s.error}
      </p>
    );
  return (
    <p className="max-w-prose text-xs text-muted-foreground">
      Last sent to {app} {timeAgo(s.at)}
      {` · ${s.ok} updated`}
      {s.notFound > 0 && ` · ${s.notFound} not in ${app}`}
      {s.failed > 0 && ` · ${s.failed} failed (will retry)`}
    </p>
  );
}

function StatusBadge({ status }: { status?: PluginStatus }) {
  if (!status || status.state === "stopped") return <Badge variant="outline">Idle</Badge>;
  if (status.state === "running") return <Badge variant="secondary">Running</Badge>;
  if (status.state === "starting") return <Badge variant="outline">Starting…</Badge>;
  return (
    <Badge variant="destructive" title={status.lastError}>
      Disconnected
    </Badge>
  );
}

function SyncLine({ c }: { c: Connection }) {
  if (c.lastError) return <p className="text-xs text-destructive">Last sync failed: {c.lastError}</p>;
  const s = c.lastSummary;
  return (
    <p className="max-w-prose text-xs text-muted-foreground">
      Last sync {timeAgo(c.lastSyncAt)}
      {s && ` · ${s.added} new`}
      {s && s.unmatched > 0 && ` · ${s.unmatched} couldn't be matched`}
    </p>
  );
}
