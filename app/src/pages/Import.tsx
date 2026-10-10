import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, History as HistoryIcon, Undo2, UserRound } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router";
import { FileDrop } from "@/components/FileDrop";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type ImportJob, type ImportSourceInfo, timeAgo } from "@/lib/api";
import { friendlyError } from "@/lib/errors";

/** How to get each service's export, shown in its dialog. */
const guide: Record<string, { blurb: string; steps: string[]; accept?: string; profile?: boolean }> = {
  trakt: {
    blurb: "Every movie and episode you've watched, with the date of each play.",
    steps: [
      "On trakt.tv, open Settings, then Data (trakt.tv/settings/data).",
      "Click Export. It's free, no VIP needed.",
      "Upload the ZIP here as it is. No need to unzip it.",
    ],
    accept: ".zip,.json",
  },
  simkl: {
    blurb: "Movies, shows and anime from your Simkl account.",
    steps: [],
    accept: ".zip,.json",
  },
  mal: {
    blurb: "Your anime list from a public MyAnimeList profile.",
    steps: ["Your list must be public (MyAnimeList Settings, then List)."],
  },
  letterboxd: {
    blurb: "Every film in your diary, rewatches included, plus films you marked watched.",
    steps: [
      "On letterboxd.com, open Settings, then Data (letterboxd.com/settings/data).",
      "Click Export your data.",
      "Upload the ZIP here, or just its diary.csv.",
    ],
    accept: ".zip,.csv",
  },
  netflix: {
    blurb: "Everything a Netflix profile watched, matched to shows and movies by title.",
    steps: [
      "On netflix.com: Account, then Profiles, pick yours, then Viewing activity, then Download all.",
      "Or, for every profile and exact times (and after cancelling): Account, then Get my info. Netflix emails a ZIP when it's ready.",
      "Upload the CSV or the ZIP as it is. For the ZIP, enter your profile's name too.",
      "From the ZIP, trailers and anything played under 5 minutes are left out.",
    ],
    accept: ".csv,.zip",
    profile: true,
  },
  imdb: {
    blurb: "Titles you rated count as watched, dated when you rated them. Single episodes come in too.",
    steps: [
      "On imdb.com, open Your ratings, then the three-dot menu, then Export.",
      "Upload ratings.csv here. A check-ins or 'watched' list export works too.",
      "Rated whole series are skipped, since a rating doesn't say which episodes you saw.",
    ],
    accept: ".csv,.zip",
  },
};

export function Import() {
  const qc = useQueryClient();
  const [open, setOpen] = useState<ImportSourceInfo | null>(null);
  const { data, error } = useQuery({ queryKey: ["imports"], queryFn: api.imports });
  const remove = useMutation({
    mutationFn: (source: string) => api.removeImport(source),
    onSuccess: () => qc.invalidateQueries(),
  });
  const names = Object.fromEntries((data?.sources ?? []).map((s) => [s.id, s.name]));
  // Newest successful run per service (history comes newest first).
  const latestRun = new Map<string, string>();
  for (const r of data?.history ?? []) if (!r.error && !latestRun.has(r.source)) latestRun.set(r.source, r.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-primary fx-neon">Import</h1>
        <p className="text-sm text-muted-foreground">
          Bring in your history from another tracker, once. Running the same import again only adds what's new.
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{friendlyError(error)}</p>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {data?.sources.map((s) => {
          const Icon = s.input === "username" ? UserRound : FileUp;
          return (
            <Card key={s.id} className="gap-3 p-5">
              <div className="flex items-center gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
                  <Icon className="size-5" />
                </div>
                <p className="font-medium">{s.name}</p>
              </div>
              <p className="text-sm text-muted-foreground">{guide[s.id]?.blurb}</p>
              <Button size="sm" className="mt-auto self-end" onClick={() => setOpen(s)}>
                Import
              </Button>
            </Card>
          );
        })}
      </div>

      {data && data.history.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Past imports</h2>
          <ul className="divide-y rounded-xl border text-sm">
            {data.history.map((r) => {
              // Undo removes everything a service's imports added, so it sits on that service's latest run.
              const undoHere = !r.error && !r.undone && latestRun.get(r.source) === r.id;
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  {undoHere ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={remove.isPending}
                      title={`Remove everything imported from ${names[r.source]}. Your own entries and app syncs stay.`}
                      onClick={() => {
                        if (
                          confirm(
                            `Remove everything the ${names[r.source]} import added? Your own entries and app syncs stay.`,
                          )
                        )
                          remove.mutate(r.source);
                      }}
                    >
                      <Undo2 /> Undo
                    </Button>
                  ) : (
                    // Same size as the button, so every row lines up.
                    <Button size="sm" variant="outline" className="invisible" tabIndex={-1} aria-hidden>
                      <Undo2 /> Undo
                    </Button>
                  )}
                  <span className="min-w-0 flex-1">
                    <strong>{names[r.source] ?? r.source}</strong> · {r.label}
                  </span>
                  <span className="text-muted-foreground">
                    {r.error
                      ? r.error
                      : r.undone
                        ? "Undone"
                        : `${r.summary.added} added · ${r.summary.titles} titles · ${r.summary.unmatched} not matched`}{" "}
                    · {timeAgo(r.finishedAt)}
                  </span>
                </li>
              );
            })}
          </ul>
          {remove.isSuccess && (
            <p className="text-sm text-muted-foreground">Removed {remove.data.removed} imported entries.</p>
          )}
        </section>
      )}

      {open && (
        <ImportDialog source={open} simklConfigured={data?.simklClientId ?? false} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

function ImportDialog({
  source,
  simklConfigured,
  onClose,
}: {
  source: ImportSourceInfo;
  simklConfigured: boolean;
  onClose: () => void;
}) {
  const [jobId, setJobId] = useState<string | null>(null);
  const g = guide[source.id];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import from {source.name}</DialogTitle>
          <DialogDescription>{g?.blurb}</DialogDescription>
        </DialogHeader>
        {jobId ? (
          <JobProgress id={jobId} onClose={onClose} />
        ) : (
          <div className="space-y-4">
            {g?.steps.length ? (
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                {g.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            ) : null}
            {source.input === "username" && <UsernameForm source={source.id} onJob={setJobId} />}
            {source.input === "file" && (
              <FileForm source={source.id} accept={g?.accept} profile={g?.profile} onJob={setJobId} />
            )}
            {source.input === "simkl" && (
              <>
                <SimklSignIn configured={simklConfigured} onJob={setJobId} />
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground">Have a SimklBackup.json instead?</summary>
                  <div className="mt-3">
                    <FileForm source="simkl" accept={g?.accept} onJob={setJobId} />
                  </div>
                </details>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FileForm({
  source,
  accept,
  profile,
  onJob,
}: {
  source: string;
  accept?: string;
  profile?: boolean; // ask which profile (Netflix's "Get my info" ZIP covers every profile)
  onJob: (id: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [profileName, setProfileName] = useState("");
  const start = useMutation({
    mutationFn: () => api.importFile(source, file as File, profileName.trim() || undefined),
    onSuccess: (job) => onJob(job.id),
  });
  return (
    <form
      className="space-y-3"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        start.mutate();
      }}
    >
      <FileDrop label="Export file" accept={accept} file={file} onFile={setFile} />
      {profile && (
        <>
          <Label htmlFor={`profile-${source}`}>Profile (for the ZIP)</Label>
          <Input
            id={`profile-${source}`}
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            placeholder="Your profile's name"
            autoComplete="off"
          />
        </>
      )}
      {start.error && <p className="text-sm text-destructive">{friendlyError(start.error)}</p>}
      <Button type="submit" className="w-full" disabled={!file || start.isPending}>
        {start.isPending ? "Uploading…" : "Import"}
      </Button>
    </form>
  );
}

function UsernameForm({ source, onJob }: { source: string; onJob: (id: string) => void }) {
  const [name, setName] = useState("");
  const start = useMutation({
    mutationFn: () => api.importUser(source, name),
    onSuccess: (job) => onJob(job.id),
  });
  return (
    <form
      className="space-y-3"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        start.mutate();
      }}
    >
      <Label htmlFor={`user-${source}`}>Username</Label>
      <Input id={`user-${source}`} value={name} onChange={(e) => setName(e.target.value)} required autoComplete="off" />
      {start.error && <p className="text-sm text-destructive">{friendlyError(start.error)}</p>}
      <Button type="submit" className="w-full" disabled={start.isPending}>
        {start.isPending ? "Starting…" : "Import"}
      </Button>
    </form>
  );
}

/** Simkl's PIN sign-in: show the code, then check every few seconds until it's been entered. */
function SimklSignIn({ configured, onJob }: { configured: boolean; onJob: (id: string) => void }) {
  const [clientId, setClientId] = useState("");
  const pin = useMutation({ mutationFn: () => api.simklPin(configured ? undefined : clientId) });
  const [checkError, setCheckError] = useState<string | null>(null);

  useEffect(() => {
    if (!pin.data) return;
    const { userCode, interval, expiresIn } = pin.data;
    const until = Date.now() + expiresIn * 1000;
    const timer = setInterval(async () => {
      if (Date.now() > until) {
        clearInterval(timer);
        setCheckError("The code expired. Start again.");
        return;
      }
      try {
        const r = await api.simklPinCheck(userCode);
        if (r.ready && r.job) {
          clearInterval(timer);
          onJob(r.job.id);
        }
      } catch (e) {
        clearInterval(timer);
        setCheckError((e as Error).message);
      }
    }, interval * 1000);
    return () => clearInterval(timer);
  }, [pin.data, onJob]);

  if (pin.data) {
    return (
      <div className="space-y-2 rounded-lg border p-4 text-sm">
        <p>
          Open{" "}
          <a href={pin.data.url} target="_blank" rel="noreferrer" className="text-primary underline">
            {pin.data.url.replace(/^https?:\/\//, "")}
          </a>{" "}
          and enter this code:
        </p>
        <p className="font-mono text-2xl tracking-widest">{pin.data.userCode}</p>
        <p className="text-muted-foreground">{checkError ?? "Waiting for Simkl… the import starts by itself."}</p>
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        pin.mutate();
      }}
    >
      {!configured && (
        <div className="space-y-1.5">
          <Label htmlFor="simkl-client">Simkl app client ID</Label>
          <Input id="simkl-client" value={clientId} onChange={(e) => setClientId(e.target.value)} required />
          <p className="text-xs text-muted-foreground">
            Create a free app at simkl.com/settings/developer (any name; redirect URI urn:ietf:wg:oauth:2.0:oob) and
            paste its client ID. Or set SIMKL_CLIENT_ID on the server.
          </p>
        </div>
      )}
      {pin.error && <p className="text-sm text-destructive">{friendlyError(pin.error)}</p>}
      <Button type="submit" className="w-full" disabled={pin.isPending}>
        Sign in with Simkl
      </Button>
    </form>
  );
}

function JobProgress({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: job } = useQuery({
    queryKey: ["import-job", id],
    queryFn: () => api.importJob(id),
    refetchInterval: (q) => ((q.state.data as ImportJob | undefined)?.status === "running" ? 1000 : false),
  });
  const finished = job && job.status !== "running";
  useEffect(() => {
    if (finished) qc.invalidateQueries();
  }, [finished, qc]);

  if (!job) return <p className="text-sm text-muted-foreground">Starting…</p>;
  if (job.status === "running") {
    const pct = job.total ? Math.round((job.done / job.total) * 100) : 0;
    return (
      <div className="space-y-2 text-sm">
        <p>
          {job.stage}… {job.total ? `${job.done} of ${job.total}` : ""}
        </p>
        <div className="h-2 overflow-hidden rounded bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-muted-foreground">You can close this; the import keeps going.</p>
      </div>
    );
  }
  if (job.status === "failed") {
    return (
      <div className="space-y-4 text-sm">
        <p className="text-destructive">{job.error}</p>
        <Button onClick={onClose} variant="outline" className="w-full">
          Close
        </Button>
      </div>
    );
  }
  const s = job.summary;
  return (
    <div className="space-y-4 text-sm">
      <p>
        {s.added > 0 ? (
          <>
            Added <strong>{s.added}</strong> entries across <strong>{s.titles}</strong> titles.
          </>
        ) : (
          <>Nothing new: everything in this import is already here.</>
        )}{" "}
        {s.unmatched > 0 && `${s.unmatched} couldn't be matched. `}
        {(s.alreadyTracked ?? 0) > 0 &&
          `${s.alreadyTracked} duplicate watches were left out (already here from a connected app, or the same viewing logged twice). `}
        {s.skipped > 0 && `${s.skipped} had nothing to import (planned, undated, or a rated series).`}
      </p>
      {job.notes.map((n) => (
        <p key={n} className="text-muted-foreground">
          {n}
        </p>
      ))}
      {job.unmatchedTitles.length > 0 && (
        <details>
          <summary className="cursor-pointer text-muted-foreground">Not matched</summary>
          <ul className="mt-2 max-h-40 list-disc overflow-auto pl-5 text-muted-foreground">
            {job.unmatchedTitles.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="flex gap-2">
        <Button asChild variant="outline" className="flex-1">
          <Link to="/history" onClick={onClose}>
            <HistoryIcon /> See History
          </Link>
        </Button>
        <Button onClick={onClose} className="flex-1">
          Done
        </Button>
      </div>
    </div>
  );
}
