"use client";

import { useEffect, useState } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import { PROVIDERS, setEnabledBridges, type BridgeProvider } from "@/lib/venues/bridge-switch";

const REFRESH_MS = 60_000;

type Listener = (off: string[]) => void;
let current: string[] = [];
const listeners = new Set<Listener>();

async function refresh() {
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    const body = (await response.json()) as { off?: unknown };
    current = Array.isArray(body.off) ? body.off.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return;
  }
  for (const listener of listeners) listener(current);
}

/** Services an admin turned off for everyone, re-read every minute (one request however many readers). */
export function useOffServices() {
  const [off, setOff] = useState<string[]>(current);
  useEffect(() => {
    listeners.add(setOff);
    if (listeners.size === 1) void refresh();
    else setOff(current);
    const timer = listeners.size === 1 ? window.setInterval(() => void refresh(), REFRESH_MS) : null;
    return () => {
      listeners.delete(setOff);
      if (timer !== null) window.clearInterval(timer);
    };
  }, []);
  return { off, refresh };
}

export const BRIDGE_PREFERENCES: Record<BridgeProvider, "bridgeAcross" | "bridgeRelay" | "bridgeLifi"> = { across: "bridgeAcross", relay: "bridgeRelay", lifi: "bridgeLifi" };

/** Keeps the bridge router on the bridges the trader left on, minus any turned off for everyone. Renders nothing. */
export function ServiceStatus() {
  const { preferences } = usePreferences();
  const { off } = useOffServices();
  useEffect(() => {
    setEnabledBridges(PROVIDERS.filter((provider) => preferences[BRIDGE_PREFERENCES[provider]] && !off.includes(`bridge:${provider}`)));
  }, [preferences, off]);
  return null;
}
