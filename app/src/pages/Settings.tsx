import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Store, Unplug } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ThresholdPicker } from "@/components/ThresholdPicker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api, type Connection, type PluginStatus, timeAgo } from "@/lib/api";

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
        </Card>
      </section>

      <Connections />
    </div>
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
                  onClick={() => remove.mutate(c.id)}
                  aria-label={`Disconnect ${name(c.pluginId)}`}
                >
                  <Unplug />
                </Button>
              </div>
              <SyncLine c={c} />
            </Card>
          </li>
        ))}
      </ul>
    </section>
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
