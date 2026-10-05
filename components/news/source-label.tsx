"use client";

import { useT } from "@/lib/i18n/client";

export function SourceLabel({ sources }: { sources: string[] }) {
  const t = useT();
  const [primary, ...rest] = sources;

  return (
    <div className="flex min-w-0 items-center gap-2 text-[12px] text-app-muted">
      <span className="truncate">{primary}</span>
      {rest.length > 0 && (
        <span
          title={rest.join(", ")}
          className="shrink-0 rounded-md bg-app-chip px-1.5 py-0.5 text-[11px] font-medium text-app-ink/75"
        >
          {t("news.moreSources", { n: rest.length })}
        </span>
      )}
    </div>
  );
}
