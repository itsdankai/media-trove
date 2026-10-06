import { cn } from "cn";
import type { SyncMode } from "@/lib/api";

const modes: { id: SyncMode; label: string; help: (app: string) => string }[] = [
  { id: "off", label: "Off", help: (app) => `Only read from ${app}. Nothing there changes.` },
  {
    id: "add",
    label: "Add only",
    help: (app) => `Things you mark watched anywhere get marked in ${app} too. Nothing in ${app} is ever unmarked.`,
  },
  {
    id: "full",
    label: "Full",
    help: (app) =>
      `Your latest action wins both ways: unmarking in MediaTrove (from now on) also unmarks it in ${app}.`,
  },
];

/** The three ways to keep an app in sync (phase 6). */
export function SyncModePicker({
  app,
  value,
  onChange,
  disabled,
  stacked,
}: {
  app: string;
  value: SyncMode;
  onChange: (m: SyncMode) => void;
  disabled?: boolean;
  /** One per row, for narrow places like the connect dialog. */
  stacked?: boolean;
}) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="mb-2 text-sm font-medium">Keep {app} in sync</legend>
      <div className={cn("grid gap-2", !stacked && "sm:grid-cols-3")}>
        {modes.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={value === m.id}
            onClick={() => onChange(m.id)}
            className={cn(
              "rounded-lg border p-3 text-left text-sm transition-colors disabled:opacity-50",
              value === m.id ? "border-primary bg-primary/10" : "hover:bg-accent/60",
            )}
          >
            <span className="font-medium">
              {m.label}
              {m.id === "add" && <span className="ml-1 text-xs text-muted-foreground">(recommended)</span>}
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">{m.help(app)}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
