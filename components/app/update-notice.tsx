"use client";

import { RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { useLatestCommit } from "./use-latest-commit";

const DISMISSED_KEY = "angler-terminal:update-dismissed";

export function UpdateNotice() {
  const t = useT();
  const { latest, isOutdated } = useLatestCommit();
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISSED_KEY));
    } catch {}
  }, []);

  if (!isOutdated || !latest || dismissed === latest) return null;

  function dismiss() {
    if (!latest) return;
    setDismissed(latest);
    try {
      localStorage.setItem(DISMISSED_KEY, latest);
    } catch {}
  }

  return (
    <div
      role="status"
      className="surface-menu fixed bottom-4 left-4 z-50 flex w-[min(340px,calc(100vw-2rem))] items-center gap-3 rounded-2xl border border-app-hairline-strong bg-app-card p-3 pl-4 text-app-ink shadow-[0_18px_40px_-16px_rgba(3,12,21,0.45)]"
    >
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold">{t("update.title")}</p>
        <p className="text-[12px] text-app-muted">{t("update.text", { version: latest.slice(0, 7) })}</p>
      </div>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-app-accent px-3 text-[13px] font-semibold text-app-on-accent transition-colors hover:bg-app-accent/85"
      >
        <RefreshCw className="size-3.5" aria-hidden />
        {t("about.refresh")}
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("update.dismiss")}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-app-muted transition-colors hover:bg-app-chip hover:text-app-ink"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
