import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clapperboard, Headphones, Link2, Plug, Search, Tv } from "lucide-react";
import { type FormEvent, useState } from "react";
import { SyncModePicker } from "@/components/SyncModePicker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type CatalogEntry, kindLabel, type SyncMode } from "@/lib/api";
import { friendlyError } from "@/lib/errors";

const kindIcon = { movie: Clapperboard, show: Tv, audiobook: Headphones };

export function Marketplace() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<CatalogEntry | null>(null);
  const { data = [], isLoading, error } = useQuery({ queryKey: ["marketplace", q], queryFn: () => api.marketplace(q) });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-primary fx-neon">Marketplace</h1>
        <p className="text-sm text-muted-foreground">
          Connect the apps you watch and listen in. MediaTrove reads your activity there. For apps that support it, you
          can also choose to keep them in sync with MediaTrove.
        </p>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search apps and services…"
          className="pl-9"
          aria-label="Search apps and services"
        />
      </div>

      {error && <p className="text-sm text-destructive">{friendlyError(error)}</p>}
      {!isLoading && data.length === 0 && <p className="text-sm text-muted-foreground">No plugins match “{q}”.</p>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {data.map((p) => (
          <Card key={p.id} className="gap-4 p-5">
            <div className="flex items-start gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
                <Plug className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{p.name}</p>
                <p className="text-xs text-muted-foreground">by {p.author}</p>
              </div>
              {p.connections > 0 && (
                <Badge variant="secondary">
                  <Check /> Connected
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{p.description}</p>
            <div className="mt-auto flex items-center justify-between gap-2">
              <div className="flex gap-1.5 text-muted-foreground">
                {p.kinds.map((k) => {
                  const Icon = kindIcon[k];
                  return <Icon key={k} className="size-4" aria-label={kindLabel[k]} />;
                })}
              </div>
              <Button size="sm" variant={p.connections ? "outline" : "default"} onClick={() => setOpen(p)}>
                {p.connections ? "Add another account" : "Connect"}
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <AddByUrl />
      {open && <ConnectDialog plugin={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ConnectDialog({ plugin, onClose }: { plugin: CatalogEntry; onClose: () => void }) {
  const qc = useQueryClient();
  const {
    data: manifest,
    error,
    isLoading,
  } = useQuery({ queryKey: ["manifest", plugin.id], queryFn: () => api.manifest(plugin.id) });
  const [values, setValues] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<SyncMode>("add");
  const canWrite = Boolean(manifest?.capabilities?.write);
  const connect = useMutation({
    mutationFn: () => {
      const fields = Object.fromEntries(
        manifest?.connect.fields.map((f) => [f.key, values[f.key] ?? f.default ?? ""]) ?? [],
      );
      return api.connect(plugin.id, fields, canWrite ? mode : "off");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["marketplace"] });
      qc.invalidateQueries({ queryKey: ["connections"] });
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    connect.mutate();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect {plugin.name}</DialogTitle>
          <DialogDescription>{manifest?.connect.note ?? plugin.description}</DialogDescription>
        </DialogHeader>

        {isLoading && <p className="text-sm text-muted-foreground">Getting ready…</p>}
        {error && <p className="text-sm text-destructive">{friendlyError(error)}</p>}

        {connect.isSuccess ? (
          <div className="space-y-4 text-sm">
            <p>
              Connected as <strong>{connect.data.accountName}</strong>. The first sync is running now. Your activity
              will show up in History in a minute or two.
            </p>
            <Button onClick={onClose} className="w-full">
              Done
            </Button>
          </div>
        ) : (
          manifest && (
            <form onSubmit={submit} className="space-y-4">
              {manifest.connect.fields.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label htmlFor={`f-${f.key}`}>{f.label}</Label>
                  <Input
                    id={`f-${f.key}`}
                    type={f.type === "url" ? "url" : f.type}
                    required={f.required}
                    placeholder={f.placeholder}
                    defaultValue={f.default}
                    autoComplete={f.type === "password" ? "current-password" : f.type === "email" ? "username" : "off"}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                  {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
                </div>
              ))}
              {canWrite && (
                <div className="space-y-1.5">
                  <SyncModePicker app={plugin.name} value={mode} onChange={setMode} stacked />
                  {mode !== "off" && (
                    <p className="text-xs text-muted-foreground">
                      What's already marked in {plugin.name} comes into MediaTrove first. Then MediaTrove's marks are
                      added there. You can change this any time in Settings.
                    </p>
                  )}
                </div>
              )}
              {connect.error && <p className="text-sm text-destructive">{friendlyError(connect.error)}</p>}
              <Button type="submit" className="w-full" disabled={connect.isPending}>
                {connect.isPending ? "Connecting…" : "Connect"}
              </Button>
            </form>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddByUrl() {
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const add = useMutation({
    mutationFn: () => api.addPluginUrl(url),
    onSuccess: () => {
      setUrl("");
      qc.invalidateQueries({ queryKey: ["marketplace"] });
    },
  });
  return (
    <details className="rounded-xl border p-4 text-sm">
      <summary className="cursor-pointer font-medium">Add a community plugin by URL</summary>
      <form
        className="mt-3 flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          type="url"
          required
          aria-label="Plugin manifest address"
          placeholder="https://my-plugin.example.com/manifest.json"
        />
        <Button type="submit" variant="secondary" disabled={add.isPending}>
          <Link2 /> Add
        </Button>
      </form>
      {add.error && <p className="mt-2 text-destructive">{friendlyError(add.error)}</p>}
      {add.isSuccess && <p className="mt-2 text-muted-foreground">Added {add.data.name}.</p>}
    </details>
  );
}
