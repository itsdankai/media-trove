// The pages you see before you're signed in (phase 10): sign in, make the first (admin) account, join by
// invite, enter a two-factor code, and set a new password from a reset link.
import { useMutation, useQuery } from "@tanstack/react-query";
import { Fingerprint, Gem } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router";
import { Problem, say } from "@/components/Problem";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient, authConfig, must } from "@/lib/auth";

// A full load, so the session the server just set is read fresh by the whole app.
const enterApp = () => window.location.replace("/");

function Shell({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <Card className="w-full max-w-sm gap-6 p-8">
        <div className="space-y-2 text-center">
          <Gem className="mx-auto size-10 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {intro && <p className="text-sm text-muted-foreground">{intro}</p>}
        </div>
        {children}
      </Card>
    </div>
  );
}

function Field(props: { id: string; label: string } & React.ComponentProps<typeof Input>) {
  const { id, label, ...rest } = props;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} required {...rest} />
    </div>
  );
}

/** Sign-in buttons for Google and the server's own login provider, when the owner set them up. */
function OtherWays({ callbackURL = "/" }: { callbackURL?: string }) {
  const { data: config } = useQuery({ queryKey: ["auth-config"], queryFn: authConfig });
  const go = useMutation({
    mutationFn: (provider: string) => must(authClient.signIn.social({ provider, callbackURL })),
  });
  if (!config?.google && !config?.oidc) return <Problem error={go.error} />;
  return (
    <div className="space-y-2">
      {config.google && (
        <Button type="button" variant="outline" className="w-full" onClick={() => go.mutate("google")}>
          Continue with Google
        </Button>
      )}
      {config.oidc && (
        <Button type="button" variant="outline" className="w-full" onClick={() => go.mutate("oidc")}>
          Continue with {config.oidc}
        </Button>
      )}
      <Problem error={go.error} />
    </div>
  );
}

export function SignIn() {
  const [params] = useSearchParams();
  const { data: config } = useQuery({ queryKey: ["auth-config"], queryFn: authConfig });
  const { data: session } = authClient.useSession();
  if (session) return <Navigate to="/" replace />;
  if (params.get("step") === "code") return <TwoFactorStep />;
  if (params.get("step") === "forgot") return <ForgotPassword />;
  if (config?.firstRun) return <FirstAccount />;
  return <PasswordSignIn />;
}

function PasswordSignIn() {
  const signIn = useMutation({
    mutationFn: (f: FormData) =>
      must(authClient.signIn.email({ email: String(f.get("email")), password: String(f.get("password")) })),
    onSuccess: (data) => {
      if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) return;
      enterApp();
    },
  });
  const passkey = useMutation({
    mutationFn: () => must(authClient.signIn.passkey()),
    onSuccess: () => enterApp(),
  });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    signIn.mutate(new FormData(e.currentTarget));
  };

  return (
    <Shell title="Sign in to MediaTrove">
      <form className="space-y-4" onSubmit={submit}>
        <Field id="email" label="Email" type="email" autoComplete="username webauthn" />
        <Field id="password" label="Password" type="password" autoComplete="current-password" />
        <Button type="submit" size="lg" className="w-full" disabled={signIn.isPending}>
          Sign in
        </Button>
        <Problem error={signIn.error} />
      </form>
      <Button variant="outline" className="w-full" onClick={() => passkey.mutate()} disabled={passkey.isPending}>
        <Fingerprint /> Sign in with a passkey
      </Button>
      <Problem error={passkey.error} />
      <OtherWays />
      <p className="text-center text-sm">
        <Link to="/sign-in?step=forgot" className="text-muted-foreground underline underline-offset-4">
          Forgot your password?
        </Link>
      </p>
    </Shell>
  );
}

/** Shared by the first account and joining by invite: name, email, password. */
function SignUpForm({ email, button }: { email?: string; button: string }) {
  const signUp = useMutation({
    mutationFn: (f: FormData) =>
      must(
        authClient.signUp.email({
          name: String(f.get("name")),
          email: String(f.get("email")),
          password: String(f.get("password")),
        }),
      ),
    onSuccess: () => enterApp(),
  });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    signUp.mutate(new FormData(e.currentTarget));
  };
  return (
    <form className="space-y-4" onSubmit={submit}>
      <Field id="name" label="Your name" autoComplete="name" />
      <Field
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        defaultValue={email}
        readOnly={Boolean(email)}
      />
      <Field
        id="password"
        label="Password (at least 10 characters)"
        type="password"
        minLength={10}
        autoComplete="new-password"
      />
      <Button type="submit" size="lg" className="w-full" disabled={signUp.isPending}>
        {button}
      </Button>
      <Problem error={signUp.error} />
    </form>
  );
}

function FirstAccount() {
  return (
    <Shell
      title="Welcome to MediaTrove"
      intro="Make the first account. It's the admin: it invites everyone else, and it keeps the library already on this server."
    >
      <SignUpForm button="Create the admin account" />
    </Shell>
  );
}

export function Join() {
  const { token = "" } = useParams();
  const invite = useQuery({
    queryKey: ["invite", token],
    queryFn: async () => {
      const res = await fetch(`/api/invites/${encodeURIComponent(token)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "This invite can't be used.");
      return body as { email: string };
    },
    retry: false,
  });
  if (invite.isPending) return null;
  if (invite.error)
    return (
      <Shell title="This invite can't be used" intro={say(invite.error)}>
        <p className="text-center text-sm text-muted-foreground">
          Ask whoever invited you for a new link, or{" "}
          <Link to="/sign-in" className="underline underline-offset-4">
            sign in
          </Link>{" "}
          if you already have an account.
        </p>
      </Shell>
    );
  return (
    <Shell
      title="Join MediaTrove"
      intro="You're invited. Make your account; your library starts empty and is yours alone."
    >
      <SignUpForm email={invite.data.email} button="Create my account" />
      <OtherWays />
    </Shell>
  );
}

function TwoFactorStep() {
  const [useBackup, setUseBackup] = useState(false);
  const verify = useMutation({
    mutationFn: (code: string) =>
      useBackup
        ? must(authClient.twoFactor.verifyBackupCode({ code }))
        : must(authClient.twoFactor.verifyTotp({ code, trustDevice: true })),
    onSuccess: () => enterApp(),
  });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    verify.mutate(String(new FormData(e.currentTarget).get("code")).replace(/\s/g, ""));
  };
  return (
    <Shell
      title="Enter your code"
      intro={
        useBackup
          ? "Type one of the backup codes you saved."
          : "Open your authenticator app and type the 6-digit code for MediaTrove."
      }
    >
      <form className="space-y-4" onSubmit={submit}>
        <Field
          id="code"
          label={useBackup ? "Backup code" : "Code"}
          inputMode={useBackup ? "text" : "numeric"}
          autoComplete="one-time-code"
          autoFocus
        />
        <Button type="submit" size="lg" className="w-full" disabled={verify.isPending}>
          Continue
        </Button>
        <Problem error={verify.error} />
      </form>
      <Button variant="ghost" onClick={() => setUseBackup(!useBackup)}>
        {useBackup ? "Use the authenticator app instead" : "Lost your phone? Use a backup code"}
      </Button>
    </Shell>
  );
}

function ForgotPassword() {
  const { data: config } = useQuery({ queryKey: ["auth-config"], queryFn: authConfig });
  const ask = useMutation({
    mutationFn: (email: string) =>
      must(authClient.requestPasswordReset({ email, redirectTo: `${window.location.origin}/reset-password` })),
  });
  if (config && !config.email)
    return (
      <Shell title="Forgot your password?" intro="This server can't send email. Ask its owner for a reset link.">
        <Button asChild variant="outline">
          <Link to="/sign-in">Back to sign in</Link>
        </Button>
      </Shell>
    );
  if (ask.isSuccess)
    return (
      <Shell
        title="Check your email"
        intro="If that address has an account, a reset link is on its way. It works for an hour."
      >
        <Button asChild variant="outline">
          <Link to="/sign-in">Back to sign in</Link>
        </Button>
      </Shell>
    );
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    ask.mutate(String(new FormData(e.currentTarget).get("email")));
  };
  return (
    <Shell title="Forgot your password?" intro="We'll email you a link to set a new one.">
      <form className="space-y-4" onSubmit={submit}>
        <Field id="email" label="Email" type="email" autoComplete="email" />
        <Button type="submit" size="lg" className="w-full" disabled={ask.isPending}>
          Send the link
        </Button>
        <Problem error={ask.error} />
      </form>
    </Shell>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const reset = useMutation({
    mutationFn: (newPassword: string) => must(authClient.resetPassword({ newPassword, token: token ?? "" })),
  });
  if (!token || params.get("error"))
    return (
      <Shell title="This link has expired" intro="Reset links work once, for an hour. Ask for a new one.">
        <Button asChild variant="outline">
          <Link to="/sign-in?step=forgot">Get a new link</Link>
        </Button>
      </Shell>
    );
  if (reset.isSuccess)
    return (
      <Shell title="Password changed" intro="You've been signed out everywhere. Sign in with the new password.">
        <Button asChild size="lg">
          <Link to="/sign-in">Sign in</Link>
        </Button>
      </Shell>
    );
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    reset.mutate(String(new FormData(e.currentTarget).get("password")));
  };
  return (
    <Shell title="Set a new password">
      <form className="space-y-4" onSubmit={submit}>
        <Field
          id="password"
          label="New password (at least 10 characters)"
          type="password"
          minLength={10}
          autoComplete="new-password"
        />
        <Button type="submit" size="lg" className="w-full" disabled={reset.isPending}>
          Save the new password
        </Button>
        <Problem error={reset.error} />
      </form>
    </Shell>
  );
}
