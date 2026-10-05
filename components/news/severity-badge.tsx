"use client";

import { useT } from "@/lib/i18n/client";
import type { Severity } from "@/lib/types";

const variants = {
  breaking: { label: "severity.breaking", className: "bg-[#fde4e1] text-[#b02a22]" },
  important: { label: "severity.important", className: "bg-[#fbefd6] text-[#87500a]" },
  notable: { label: "severity.notable", className: "bg-app-chip text-app-ink/75" },
} as const satisfies Record<Severity, { label: string; className: string }>;

export function SeverityBadge({ severity }: { severity: Severity }) {
  const t = useT();
  const { label, className } = variants[severity];

  return (
    <span
      className={`rounded px-1.5 py-[3px] text-[10px] font-semibold uppercase leading-none tracking-[0.08em] ${className}`}
    >
      {t(label)}
    </span>
  );
}
