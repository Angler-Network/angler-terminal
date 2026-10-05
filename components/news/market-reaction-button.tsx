"use client";

import { ChartLine } from "lucide-react";
import { useT } from "@/lib/i18n/client";

export function MarketReactionButton() {
  const t = useT();
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1.5 rounded-lg border border-app-hairline-strong bg-app-chip px-3 py-1.5 text-[12px] font-semibold text-app-ink transition-colors hover:bg-app-chip"
    >
      <ChartLine className="size-3.5" aria-hidden />
      {t("news.marketReaction")}
    </button>
  );
}
