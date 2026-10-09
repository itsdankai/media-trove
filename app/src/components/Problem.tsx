// Shared by the sign-in pages and Settings → Account/People (phase 10). Better Auth's messages are already
// sentences about the sign-in itself, so they're shown as they are.
import type { FormEvent } from "react";

export const say = (err: unknown) => {
  const m = err instanceof Error ? err.message : "";
  return /failed to fetch|networkerror/i.test(m)
    ? "Can't reach the MediaTrove server. Check that it's running, then try again."
    : m || "Something went wrong. Try again.";
};

export const Problem = ({ error }: { error: unknown }) =>
  error ? (
    <p role="alert" className="text-sm text-destructive">
      {say(error)}
    </p>
  ) : null;

export const formValue = (e: FormEvent<HTMLFormElement>, name: string) =>
  String(new FormData(e.currentTarget).get(name) ?? "");
