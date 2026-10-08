import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Gem } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { ThresholdPicker } from "@/components/ThresholdPicker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api } from "@/lib/api";
import { friendlyError } from "@/lib/errors";

/** First run: shown until setup is saved once. */
export function Setup() {
  const [threshold, setThreshold] = useState(0.9);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: () => api.saveSettings({ watchedThreshold: threshold, setupComplete: true }),
    onSuccess: (s) => {
      qc.setQueryData(["settings"], s);
      navigate("/marketplace");
    },
  });

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <Card className="w-full max-w-md gap-8 p-8">
        <div className="space-y-2 text-center">
          <Gem className="mx-auto size-10 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">Welcome to MediaTrove</h1>
          <p className="text-sm text-muted-foreground">
            One quick choice, then you can connect your apps. You can change this any time in Settings.
          </p>
        </div>
        <ThresholdPicker value={threshold} onChange={setThreshold} />
        <Button size="lg" onClick={() => save.mutate()} disabled={save.isPending}>
          Save and connect apps
        </Button>
        {save.error && <p className="text-sm text-destructive">{friendlyError(save.error)}</p>}
      </Card>
    </div>
  );
}
