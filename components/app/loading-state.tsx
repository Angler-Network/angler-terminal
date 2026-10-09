"use client";

import { LoaderCircle, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";

const SLOW_MS = 6_000;
const STUCK_MS = 20_000;

/**
 * A loading message that keeps the user informed on a slow connection: a spinner right away, "still loading" after a
 * few seconds, and a Reload button once it has taken far longer than usual, so a wait never looks like a broken page.
 */
export function LoadingState({ label, className = "", compact = false }: { label: string; className?: string; compact?: boolean }) {
  const [stage, setStage] = useState<"loading" | "slow" | "stuck">("loading");
  useEffect(() => {
    const slow = window.setTimeout(() => setStage("slow"), SLOW_MS);
    const stuck = window.setTimeout(() => setStage("stuck"), STUCK_MS);
    return () => {
      window.clearTimeout(slow);
      window.clearTimeout(stuck);
    };
  }, []);
  return (
    <div role="status" aria-live="polite" className={`flex flex-col items-center justify-center gap-1.5 text-center ${compact ? "py-3 text-[12px]" : "py-8 text-[13px]"} ${className}`}>
      <span className="flex items-center gap-2 text-app-muted">
        <LoaderCircle className="size-4 animate-spin text-app-accent" aria-hidden />
        {label}
      </span>
      {stage !== "loading" && <span className="max-w-[260px] text-[11px] text-app-faint">Still loading. This can take longer on a slow connection.</span>}
      {stage === "stuck" && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-1 inline-flex h-7 items-center gap-1.5 rounded-lg bg-app-chip px-2.5 text-[12px] font-semibold text-app-ink hover:bg-app-selected"
        >
          <RotateCw className="size-3.5" aria-hidden />
          Reload
        </button>
      )}
    </div>
  );
}
