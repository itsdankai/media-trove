// Email through Resend (resend.com: free for 3,000 emails a month, on one domain you verify with them).
// Used for invites and password resets (phase 10) and, optionally, the weekly backup. Turned on by:
//   RESEND_API_KEY        the API key from your Resend account
//   MEDIATROVE_EMAIL_FROM a sender on your verified domain, e.g. "MediaTrove <mediatrove@example.com>"
//                         (MEDIATROVE_BACKUP_EMAIL_FROM, its older name, still works)
// The weekly backup is emailed only when MEDIATROVE_BACKUP_EMAIL_TO is set too: the admin's backup goes there.
// Nothing is sent otherwise. The file is the same one saved in the library's backups folder.
import type { Mailer } from "./accounts.ts";

type Env = Partial<Record<"RESEND_API_KEY" | "MEDIATROVE_EMAIL_FROM" | "MEDIATROVE_BACKUP_EMAIL_FROM", string>>;

/** Sends email, or null when email isn't set up. */
export function mailer(env: Env = process.env, fetchFn: typeof fetch = fetch): Mailer | null {
  const from = env.MEDIATROVE_EMAIL_FROM || env.MEDIATROVE_BACKUP_EMAIL_FROM;
  if (!env.RESEND_API_KEY || !from) return null;
  return async (to, subject, text, attachments) => {
    const res = await fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text, attachments }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Resend returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  };
}

export async function emailBackup(
  mail: Mailer | null,
  to: string | undefined,
  file: string,
  json: string,
  summary: { titles: number; events: number },
) {
  if (!mail || !to) return false;
  await mail(
    to,
    `Your MediaTrove backup (${file.replace(/^mediatrove-|\.json$/g, "")})`,
    [
      `Attached: your weekly MediaTrove backup, ${summary.titles} titles and ${summary.events} entries.`,
      "To restore it: Settings, then Backups, then Restore. Nothing you have is removed, and restoring twice adds nothing twice.",
      "App connections aren't in the file; reconnect your apps after a restore.",
    ].join("\n\n"),
    [{ filename: file, content: Buffer.from(json).toString("base64") }],
  );
  return true;
}
