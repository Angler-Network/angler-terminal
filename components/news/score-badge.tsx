"use client";

import { useT } from "@/lib/i18n/client";

export function ScoreBadge({ score }: { score: number }) {
  const t = useT();
  return (
    <span
      title={t("studio.impact")}
      className="inline-flex min-w-7 items-center justify-center rounded-md border border-app-hairline-strong bg-app-card px-1.5 py-0.5 text-[12px] font-semibold tabular-nums text-app-ink"
    >
      {score}
    </span>
  );
}
