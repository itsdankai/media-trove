import { Slider } from "@/components/ui/slider";

/** "What % counts as watched?" Used in first-run setup and in Settings. */
export function ThresholdPicker({
  value,
  onChange,
  onCommit,
}: {
  value: number;
  onChange: (v: number) => void;
  /** Called when the slider is let go (Settings saves then, like its other controls). */
  onCommit?: (v: number) => void;
}) {
  const pct = Math.round(value * 100);
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">Count as watched at</span>
        <span className="text-2xl font-semibold tabular-nums text-primary">{pct}%</span>
      </div>
      <Slider
        value={[pct]}
        min={50}
        max={100}
        step={1}
        onValueChange={([v]) => onChange(v / 100)}
        onValueCommit={([v]) => onCommit?.(v / 100)}
        aria-label="Watched threshold"
      />
      <p className="text-xs text-muted-foreground">
        When a movie or episode reaches {pct}% in any connected app, it's marked watched, so skipping the credits still
        counts. It stays watched even if you go back later.
      </p>
    </div>
  );
}
