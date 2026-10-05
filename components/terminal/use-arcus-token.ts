"use client";

import { useEffect, useState } from "react";
import { resolveArcusToken } from "@/lib/venues/arcus/catalog";
import type { ArcusToken } from "@/lib/venues/arcus/tokens";

/** Arcus stock token for a symbol. undefined while loading, null when there's none or `enabled` is false. */
export function useArcusToken(symbol: string, enabled = true) {
  const [state, setState] = useState<{ symbol: string; token: ArcusToken | null } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let isActive = true;
    resolveArcusToken(symbol)
      .then((token) => isActive && setState({ symbol, token }))
      .catch(() => isActive && setState({ symbol, token: null }));
    return () => {
      isActive = false;
    };
  }, [symbol, enabled]);

  if (!enabled) return null;
  return state?.symbol === symbol ? state.token : undefined;
}
