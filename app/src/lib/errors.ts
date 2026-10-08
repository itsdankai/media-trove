// Turns the raw errors the API and plugins return into a sentence that says what happened and what
// to try next (Impeccable critique 2026-10-08: self-hosters were shown bare error strings).

const rules: [RegExp, (m: RegExpMatchArray) => string][] = [
  [
    /failed to fetch|networkerror|load failed/i,
    () => "Can't reach the MediaTrove server. Check that it's running, then try again.",
  ],
  [
    /^(\S+) plugin (didn't start within \d+s|exited while starting)/,
    (m) => `The ${m[1]} plugin didn't start. Try again in a minute. If it keeps failing, restart MediaTrove.`,
  ],
  [
    /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|timed? ?out/i,
    () => "Couldn't reach that app. Check the address (and that it's running), then try again.",
  ],
  [
    /\b(401|403)\b|unauthori[sz]ed|forbidden|invalid (token|credentials|password)/i,
    () => "That app refused the login. Check the username, password or token, then try again.",
  ],
  [
    /^Request failed \((5\d\d)\)/,
    (m) =>
      `Something went wrong on the server (error ${m[1]}). Try again; if it keeps happening, check the server log.`,
  ],
  [/^not found$/i, () => "That isn't in your library or the catalog any more."],
];

/** A plain-language version of an error, ending with what to do next. */
export function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  for (const [re, say] of rules) {
    const m = raw.match(re);
    if (m) return say(m);
  }
  const text = raw.trim() || "Something went wrong";
  return /[.!?]$/.test(text) ? text : `${text}. Try again.`;
}
