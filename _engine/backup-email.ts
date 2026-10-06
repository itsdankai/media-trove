// Emails the weekly backup (optional). Uses Resend (resend.com: free for 3,000 emails a month, on one
// domain you verify with them). Turned on by setting all three:
//   RESEND_API_KEY              the API key from your Resend account
//   MEDIATROVE_BACKUP_EMAIL_TO  where the backup goes
//   MEDIATROVE_BACKUP_EMAIL_FROM  a sender on your verified domain, e.g. "MediaTrove <backups@example.com>"
// Nothing is sent otherwise. The file is the same one saved in <data>/backups.

type Env = Partial<Record<"RESEND_API_KEY" | "MEDIATROVE_BACKUP_EMAIL_TO" | "MEDIATROVE_BACKUP_EMAIL_FROM", string>>;

export function emailConfigured(env: Env = process.env) {
  return Boolean(env.RESEND_API_KEY && env.MEDIATROVE_BACKUP_EMAIL_TO && env.MEDIATROVE_BACKUP_EMAIL_FROM);
}

export async function emailBackup(
  file: string,
  json: string,
  summary: { titles: number; events: number },
  env: Env = process.env,
  fetchFn: typeof fetch = fetch,
) {
  if (!emailConfigured(env)) return false;
  const res = await fetchFn("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.MEDIATROVE_BACKUP_EMAIL_FROM,
      to: [env.MEDIATROVE_BACKUP_EMAIL_TO],
      subject: `Your MediaTrove backup (${file.replace(/^mediatrove-|\.json$/g, "")})`,
      text: [
        `Attached: your weekly MediaTrove backup, ${summary.titles} titles and ${summary.events} entries.`,
        "To restore it: Settings, then Backups, then Restore. Nothing you have is removed, and restoring twice adds nothing twice.",
        "App connections aren't in the file; reconnect your apps after a restore.",
      ].join("\n\n"),
      attachments: [{ filename: file, content: Buffer.from(json).toString("base64") }],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Resend returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return true;
}
