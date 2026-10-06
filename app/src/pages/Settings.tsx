import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, RefreshCw, RotateCcw, Store, Unplug, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { SyncModePicker } from "@/components/SyncModePicker";
import { ThresholdPicker } from "@/components/ThresholdPicker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api, type Connection, type PluginStatus, type SyncMode, timeAgo } from "@/lib/api";

export function Settings() {
  const qc = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
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
    <div className="mx-auto max-w-3xl space-y-10">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <section className="space-y-4">
        <h2 className="text-lg font-medium">Tracking</h2>
        <Card className="gap-5 p-5">
          <ThresholdPicker value={threshold} onChange={setThreshold} />
          <div className="flex items-center gap-3">
            <Button onClick={() => save.mutate()} disabled={save.isPending || threshold === settings?.watchedThreshold}>
              Save
            </Button>
            {save.isSuccess && threshold === settings?.watchedThreshold && (
              <span className="text-sm text-muted-foreground">Saved. Your library was recalculated.</span>
            )}
          </div>
          {settings && <CaughtUpWindow days={settings.caughtUpDays} />}
        </Card>
      </section>

      <Connections />

      <Backups />
    </div>
  );
}

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
      <p className="text-xs text-muted-foreground">
        When you've seen every aired episode. Further off than this (a new season next year), the show reads Completed
        until the date gets close.
      </p>
    </div>
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
          <span className="font-medium">Restore</span>
          <Input
            type="file"
            accept=".json"
            className="max-w-xs"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <Button type="submit" size="sm" variant="outline" disabled={!file || restore.isPending}>
            <Upload /> Restore
          </Button>
          {restore.error && <p className="w-full text-destructive">{restore.error.message}</p>}
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
        <h2 className="text-lg font-medium">Connected apps</h2>
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
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{name(c.pluginId)}</p>
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
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => remove.mutate(c.id)}
                  aria-label={`Disconnect ${name(c.pluginId)}`}
                >
                  <Unplug />
                </Button>
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
                  <span className="block text-xs text-muted-foreground">
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
          {preview.error && <p className="text-destructive">{preview.error.message}</p>}
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
  if (c.pushing) return <p className="text-xs text-muted-foreground">Sending changes to {app}…</p>;
  if (!s) return <p className="text-xs text-muted-foreground">Changes go to {app} after the next sync.</p>;
  if (s.error)
    return (
      <p className="text-xs text-destructive">
        Couldn't update {app}: {s.error}
      </p>
    );
  return (
    <p className="text-xs text-muted-foreground">
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
    <p className="text-xs text-muted-foreground">
      Last sync {timeAgo(c.lastSyncAt)}
      {s && ` · ${s.added} new`}
      {s && s.unmatched > 0 && ` · ${s.unmatched} couldn't be matched`}
    </p>
  );
}
