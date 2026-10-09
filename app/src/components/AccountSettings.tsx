// Settings → Account (everyone) and Settings → People (the admin), phase 10.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, Fingerprint, KeyRound, LogOut, Trash2, UserPlus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import { renderSVG } from "uqr";
import { Confirm } from "@/components/Confirm";
import { formValue, Problem } from "@/components/Problem";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, timeAgo } from "@/lib/api";
import { authClient, authConfig, must, passkeyBlocker } from "@/lib/auth";

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <Input readOnly value={link} aria-label="Link" onFocus={(e) => e.currentTarget.select()} />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => navigator.clipboard.writeText(link).then(() => setCopied(true))}
      >
        <Copy /> {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

export function Account() {
  const { data: session } = authClient.useSession();
  const navigate = useNavigate();
  const user = session?.user as { name: string; email: string; twoFactorEnabled?: boolean | null } | undefined;
  const signOut = useMutation({
    mutationFn: () => must(authClient.signOut()),
    onSuccess: () => navigate("/sign-in", { replace: true }),
  });
  if (!user) return null;

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">Account</h2>
      <Card className="flex-row flex-wrap items-center justify-between gap-3 p-5 text-sm">
        <div>
          <p className="font-medium">{user.name}</p>
          <p className="text-muted-foreground">{user.email}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => signOut.mutate()}>
          <LogOut /> Sign out
        </Button>
      </Card>
      <ChangePassword />
      <Passkeys />
      <TwoFactor enabled={Boolean(user.twoFactorEnabled)} />
      <YourData />
    </section>
  );
}

function ChangePassword() {
  const change = useMutation({
    mutationFn: (v: { currentPassword: string; newPassword: string }) =>
      must(authClient.changePassword({ ...v, revokeOtherSessions: true })),
  });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    change.mutate({ currentPassword: formValue(e, "current"), newPassword: formValue(e, "new") });
    e.currentTarget.reset();
  };
  return (
    <Card className="gap-4 p-5 text-sm">
      <h3 className="font-medium">Password</h3>
      <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={submit}>
        <div className="space-y-1.5">
          <Label htmlFor="current">Current password</Label>
          <Input id="current" name="current" type="password" required autoComplete="current-password" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new">New password</Label>
          <Input id="new" name="new" type="password" required minLength={10} autoComplete="new-password" />
        </div>
        <Button type="submit" disabled={change.isPending}>
          Change
        </Button>
      </form>
      {change.isSuccess && <p className="text-muted-foreground">Changed. Other devices were signed out.</p>}
      <Problem error={change.error} />
    </Card>
  );
}

function Passkeys() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["passkeys"], queryFn: () => must(authClient.passkey.listUserPasskeys()) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["passkeys"] });
  const add = useMutation({ mutationFn: () => must(authClient.passkey.addPasskey()), onSuccess: refresh });
  const remove = useMutation({
    mutationFn: (id: string) => must(authClient.passkey.deletePasskey({ id })),
    onSuccess: refresh,
  });
  return (
    <Card className="gap-4 p-5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h3 className="font-medium">Passkeys</h3>
          <p className="max-w-prose text-muted-foreground">
            Sign in with your fingerprint, face or screen lock instead of typing a password.
          </p>
        </div>
        {!passkeyBlocker() && (
          <Button variant="secondary" size="sm" onClick={() => add.mutate()} disabled={add.isPending}>
            <Fingerprint /> Add a passkey
          </Button>
        )}
      </div>
      {passkeyBlocker() && <p className="text-muted-foreground">{passkeyBlocker()}</p>}
      {list.data && list.data.length > 0 && (
        <ul className="divide-y border-t">
          {list.data.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2">
              <span>
                {p.name || p.deviceType || "Passkey"}
                <span className="text-muted-foreground"> · added {timeAgo(new Date(p.createdAt).getTime())}</span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => remove.mutate(p.id)} aria-label="Remove passkey">
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Problem error={add.error ?? remove.error} />
    </Card>
  );
}

function TwoFactor({ enabled }: { enabled: boolean }) {
  const [setup, setSetup] = useState<{ totpURI: string; backupCodes: string[] } | null>(null);
  const start = useMutation({
    mutationFn: (password: string) => must(authClient.twoFactor.enable({ password })),
    onSuccess: (r) => r && "totpURI" in r && setSetup(r),
  });
  const confirm = useMutation({
    mutationFn: (code: string) => must(authClient.twoFactor.verifyTotp({ code })),
    onSuccess: () => setSetup(null),
  });
  const off = useMutation({ mutationFn: (password: string) => must(authClient.twoFactor.disable({ password })) });

  return (
    <Card className="gap-4 p-5 text-sm">
      <div className="space-y-1">
        <h3 className="flex items-center gap-2 font-medium">
          Two-factor sign-in {enabled && <Badge variant="outline">On</Badge>}
        </h3>
        <p className="max-w-prose text-muted-foreground">
          After your password, sign-in also asks for a 6-digit code from an authenticator app on your phone.
        </p>
      </div>
      {setup ? (
        <div className="space-y-4">
          <p>Scan this with your authenticator app, then type the code it shows.</p>
          <div
            className="size-44 rounded-md bg-white p-2"
            role="img"
            aria-label="QR code for your authenticator app"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG generated locally by uqr from our own TOTP address
            dangerouslySetInnerHTML={{ __html: renderSVG(setup.totpURI) }}
          />
          <p className="text-muted-foreground">
            On this phone?{" "}
            <a href={setup.totpURI} className="underline underline-offset-4">
              Open in the app
            </a>
            .
          </p>
          <div className="space-y-1">
            <p className="font-medium">Backup codes</p>
            <p className="text-muted-foreground">
              Save these somewhere safe. Each one signs you in once if you lose your phone.
            </p>
            <pre className="rounded-md bg-muted p-3 font-mono text-xs leading-6">{setup.backupCodes.join("\n")}</pre>
          </div>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              confirm.mutate(formValue(e, "code").replace(/\s/g, ""));
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="totp-code">Code from the app</Label>
              <Input id="totp-code" name="code" required inputMode="numeric" autoComplete="one-time-code" />
            </div>
            <Button type="submit" disabled={confirm.isPending}>
              Turn on
            </Button>
          </form>
          <Problem error={confirm.error} />
        </div>
      ) : (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            (enabled ? off : start).mutate(formValue(e, "password"));
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="tf-password">Your password</Label>
            <Input id="tf-password" name="password" type="password" required autoComplete="current-password" />
          </div>
          <Button type="submit" variant={enabled ? "secondary" : "default"} disabled={start.isPending || off.isPending}>
            <KeyRound /> {enabled ? "Turn off" : "Set up"}
          </Button>
        </form>
      )}
      <Problem error={start.error ?? off.error} />
    </Card>
  );
}

function YourData() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const remove = useMutation({
    mutationFn: () => must(authClient.deleteUser({ password })),
    onSuccess: () => navigate("/sign-in", { replace: true }),
  });
  return (
    <Card className="gap-4 p-5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h3 className="font-medium">Your data</h3>
          <p className="max-w-prose text-muted-foreground">
            Everything you've tracked, as one file you can keep or restore.
          </p>
        </div>
        <Button asChild variant="secondary" size="sm">
          <a href="/api/backup" download>
            <Download /> Export
          </a>
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-2 border-t pt-4">
        <div className="space-y-1.5">
          <Label htmlFor="delete-password">Delete my account</Label>
          <Input
            id="delete-password"
            type="password"
            placeholder="Your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        <Confirm
          title="Delete your account?"
          description="Your library, history, connected apps and backups on this server are deleted for good, and you're signed out. Export first if you want to keep a copy."
          action="Delete my account"
          onConfirm={() => remove.mutate()}
        >
          <Button variant="destructive" disabled={!password || remove.isPending}>
            <Trash2 /> Delete
          </Button>
        </Confirm>
      </div>
      <Problem error={remove.error} />
    </Card>
  );
}

export function People() {
  const qc = useQueryClient();
  const { data: config } = useQuery({ queryKey: ["auth-config"], queryFn: authConfig });
  const { data } = useQuery({ queryKey: ["people"], queryFn: api.people });
  const { data: session } = authClient.useSession();
  const refresh = () => qc.invalidateQueries({ queryKey: ["people"] });
  const invite = useMutation({ mutationFn: api.invite, onSuccess: refresh });
  const revoke = useMutation({ mutationFn: api.revokeInvite, onSuccess: refresh });
  const reset = useMutation({ mutationFn: api.resetLink });
  const remove = useMutation({ mutationFn: api.removePerson, onSuccess: refresh });
  const joinLink = (token: string) => `${window.location.origin}/join/${token}`;

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">People</h2>
      <Card className="gap-4 p-5 text-sm">
        <div className="space-y-1">
          <h3 className="font-medium">Invite someone</h3>
          <p className="max-w-prose text-muted-foreground">
            They get their own empty library; nobody sees anyone else's. The link works once, for 7 days, and only for
            that email address.
            {config?.signups === "open" && " (Sign-ups are open on this server, so anyone can join without one.)"}
          </p>
        </div>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            invite.mutate(formValue(e, "email"));
            e.currentTarget.reset();
          }}
        >
          <div className="min-w-56 flex-1 space-y-1.5">
            <Label htmlFor="invite-email">Their email</Label>
            <Input id="invite-email" name="email" type="email" required />
          </div>
          <Button type="submit" disabled={invite.isPending}>
            <UserPlus /> Invite
          </Button>
        </form>
        {invite.data && (
          <div className="space-y-2">
            <p>{invite.data.emailed ? "Emailed. You can also send them this link:" : "Send them this link:"}</p>
            <CopyLink link={invite.data.link} />
          </div>
        )}
        <Problem error={invite.error} />
        {data && data.invites.length > 0 && (
          <ul className="divide-y border-t">
            {data.invites.map((i) => (
              <li key={i.token} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {i.email}
                  <span className="text-muted-foreground"> · invited {timeAgo(i.createdAt)}</span>
                </span>
                <span className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(joinLink(i.token))}>
                    <Copy /> Copy link
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => revoke.mutate(i.token)}>
                    Cancel
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="gap-3 p-5 text-sm">
        <h3 className="font-medium">Accounts</h3>
        <ul className="divide-y">
          {data?.people.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                {p.name} <span className="text-muted-foreground">· {p.email}</span>{" "}
                {p.role === "admin" && <Badge variant="outline">Admin</Badge>}
              </span>
              {p.id !== session?.user.id && (
                <span className="flex gap-1">
                  {!config?.email && (
                    <Button variant="ghost" size="sm" onClick={() => reset.mutate(p.id)}>
                      <KeyRound /> Reset link
                    </Button>
                  )}
                  <Confirm
                    title={`Remove ${p.name}?`}
                    description={`${p.email} is signed out, and their library, history and connected apps on this server are deleted for good.`}
                    action="Remove"
                    onConfirm={() => remove.mutate(p.id)}
                  >
                    <Button variant="ghost" size="sm" aria-label={`Remove ${p.name}`}>
                      <Trash2 />
                    </Button>
                  </Confirm>
                </span>
              )}
            </li>
          ))}
        </ul>
        {reset.data && (
          <div className="space-y-2 border-t pt-3">
            <p>Send them this link to set a new password (it works once, for an hour):</p>
            <CopyLink link={reset.data.link} />
          </div>
        )}
        <Problem error={reset.error ?? remove.error} />
      </Card>
    </section>
  );
}
