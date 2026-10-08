"use client";

import { useEffect } from "react";

/** Starts the freeze recorder (`lib/debug/trail.ts`) only in a browser that opted in; nothing loads otherwise. */
export function DebugTrail() {
  useEffect(() => {
    let enabled = false;
    try {
      enabled = localStorage.getItem("angler:debug") === "1";
    } catch {}
    if (enabled) void import("@/lib/debug/trail").then(({ startTrail }) => startTrail());
  }, []);
  return null;
}
