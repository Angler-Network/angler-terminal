"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import type { Direction } from "@/lib/types";

interface SymbolChipProps {
  symbol: string;
  direction: Direction;
}

export function SymbolChip({ symbol, direction }: SymbolChipProps) {
  const t = useT();
  const isUp = direction === "up";
  const Arrow = isUp ? ArrowUp : ArrowDown;

  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-app-ink">
      ${symbol}
      <span
        className={`inline-flex size-4 items-center justify-center rounded ${
          isUp ? "bg-[#e2f4ea] text-app-up" : "bg-[#fde8e6] text-app-down"
        }`}
      >
        <Arrow className="size-3" strokeWidth={2.5} aria-label={isUp ? t("market.up") : t("market.down")} />
      </span>
    </span>
  );
}
