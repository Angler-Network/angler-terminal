"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import { defaultSize, sizePresets, type TradeVenueKind } from "@/lib/trading/presets";
import type { OrderSide } from "@/lib/venues/types";
import { useSelectedAsset } from "./selected-asset";

/**
 * A trade armed from a news item. The order panel shows it preselected; nothing is sent until `confirm()`
 * bumps `confirmNonce` (second click, repeated shortcut, or one-click mode), and the panel then places it.
 */
export interface TradeTicket {
  id: number;
  symbol: string;
  mint?: string;
  venue: TradeVenueKind;
  side: OrderSide;
  sizeUsd: number;
  newsId?: string;
  confirmNonce: number;
  oneClick: boolean;
}

export interface ArmInput {
  symbol: string;
  mint?: string;
  venue: TradeVenueKind;
  side: OrderSide;
  newsId?: string;
}

interface TradeTicketContextValue {
  ticket: TradeTicket | null;
  /** First click arms; arming the same asset and side again confirms. */
  arm: (input: ArmInput) => void;
  confirm: () => void;
  cancel: () => void;
  setSizePreset: (index: number) => void;
  /** Called by the panel once the confirmed order was sent (success or failure). */
  settle: (id: number) => void;
  selectedNewsId: string | null;
  selectNews: (id: string | null) => void;
}

const TradeTicketContext = createContext<TradeTicketContextValue | null>(null);

export function useTradeTicket() {
  const context = useContext(TradeTicketContext);
  if (!context) throw new Error("useTradeTicket must be used within TradeTicketProvider");
  return context;
}

export function TradeTicketProvider({ children }: { children: React.ReactNode }) {
  const { preferences } = usePreferences();
  const { selectAsset } = useSelectedAsset();
  const [ticket, setTicket] = useState<TradeTicket | null>(null);
  const [selectedNewsId, setSelectedNewsId] = useState<string | null>(null);
  const nextId = useRef(1);
  const ticketRef = useRef(ticket);
  ticketRef.current = ticket;

  const confirm = useCallback(() => {
    setTicket((current) => (current ? { ...current, confirmNonce: current.confirmNonce + 1 } : current));
  }, []);

  const arm = useCallback(
    (input: ArmInput) => {
      const current = ticketRef.current;
      if (current && current.symbol === input.symbol && current.venue === input.venue && current.side === input.side && current.newsId === input.newsId) {
        confirm();
        return;
      }
      selectAsset(input.symbol, input.mint);
      if (input.newsId) setSelectedNewsId(input.newsId);
      const oneClick = preferences.oneClickTrading;
      setTicket({
        id: nextId.current++,
        ...input,
        sizeUsd: defaultSize(input.venue, input.venue === "perp" ? preferences.defaultPerpUsd : preferences.defaultSpotUsd),
        confirmNonce: oneClick ? 1 : 0,
        oneClick,
      });
    },
    [confirm, selectAsset, preferences.oneClickTrading, preferences.defaultPerpUsd, preferences.defaultSpotUsd],
  );

  const cancel = useCallback(() => setTicket(null), []);

  const settle = useCallback((id: number) => setTicket((current) => (current?.id === id ? null : current)), []);

  const setSizePreset = useCallback((index: number) => {
    setTicket((current) => {
      if (!current) return current;
      const size = sizePresets[current.venue][index];
      return size ? { ...current, sizeUsd: size } : current;
    });
  }, []);

  const value = useMemo(
    () => ({ ticket, arm, confirm, cancel, setSizePreset, settle, selectedNewsId, selectNews: setSelectedNewsId }),
    [ticket, arm, confirm, cancel, setSizePreset, settle, selectedNewsId],
  );
  return <TradeTicketContext.Provider value={value}>{children}</TradeTicketContext.Provider>;
}
