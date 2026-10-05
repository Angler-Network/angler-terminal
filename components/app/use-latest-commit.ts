"use client";

import { useEffect, useState } from "react";
import { commitSha } from "@/lib/site";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

export function useLatestCommit() {
  const [latest, setLatest] = useState<string | null>(null);

  useEffect(() => {
    if (!commitSha) return;
    let isActive = true;

    const check = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await fetch("/api/version", { cache: "no-store" });
        if (!response.ok) return;
        const data: { commit?: string } = await response.json();
        if (isActive && data.commit) setLatest(data.commit);
      } catch {}
    };

    void check();
    const interval = window.setInterval(check, CHECK_INTERVAL_MS);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      isActive = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  const isOutdated = Boolean(latest && latest !== commitSha);
  return { latest, isOutdated };
}
