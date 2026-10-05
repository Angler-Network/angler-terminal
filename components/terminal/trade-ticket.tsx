"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import { defaultSize, sizePresets, type TradeVenueKind } from "@/lib/trading/presets";
import type { OrderSide, PerpVenueId, SpotVenueId } from "@/lib/venues/types";
import { useSelectedAsset } from "./selected-asset";
import { useNewsTrader, type NewsTrade } from "./use-news-trader";

/**
 * The armed news trade: one size button (or a keyboard selection) waiting for its confirm click. Nothing is sent
 * until `confirm()`, or immediately when one-click trading is on.
 */
export interface TradeTicket {
  symbol: string;
  mint?: string;
  venue: TradeVenueKind;
  /** Which perp venue a perp ticket goes to (from the resolver: preferred venue, else the fallback). */
  perpVenue?: PerpVenueId;
  /** Which spot venue a spot ticket goes to (Jupiter unless the resolver picked Arcus). */
  spotVenue?: SpotVenueId;
  side: OrderSide;
  sizeUsd: number;
  newsId?: string;
}

export interface ArmInput extends Omit<TradeTicket, "sizeUsd"> {
  /** Defaults to the user's default size for the venue. */
  sizeUsd?: number;
}

export function ticketKey(ticket: Pick<TradeTicket, "newsId" | "symbol" | "side" | "sizeUsd">) {
  return `${ticket.newsId ?? ""}|${ticket.symbol}|${ticket.side}|${ticket.sizeUsd}`;
}

interface TradeTicketContextValue {
  ticket: TradeTicket | null;
  /** Key of the trade being sent right now, for a spinner and to block double sends. */
  pendingKey: string | null;
  /** First press arms; pressing the same button again (or one-click mode) places it. */
  press: (input: ArmInput) => void;
  confirm: () => void;
  cancel: () => void;
  setSizePreset: (index: number) => void;
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
  const trade = useNewsTrader();
  const [ticket, setTicket] = useState<TradeTicket | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [selectedNewsId, setSelectedNewsId] = useState<string | null>(null);
  const ticketRef = useRef(ticket);
  ticketRef.current = ticket;
  const pendingRef = useRef(pendingKey);
  pendingRef.current = pendingKey;

  const send = useCallback(
    async (next: TradeTicket, oneClick: boolean) => {
      const key = ticketKey(next);
      if (pendingRef.current) return;
      setPendingKey(key);
      setTicket(null);
      const order: NewsTrade = { ...next, oneClick };
      try {
        await trade(order);
      } finally {
        setPendingKey(null);
      }
    },
    [trade],
  );

  const press = useCallback(
    (input: ArmInput) => {
      const next: TradeTicket = {
        ...input,
        sizeUsd: input.sizeUsd ?? defaultSize(input.venue, input.venue === "perp" ? preferences.defaultPerpUsd : preferences.defaultSpotUsd),
      };
      selectAsset(next.symbol, next.mint);
      if (next.newsId) setSelectedNewsId(next.newsId);
      const current = ticketRef.current;
      if (preferences.oneClickTrading) return void send(next, true);
      if (current && ticketKey(current) === ticketKey(next)) return void send(next, false);
      setTicket(next);
    },
    [preferences.oneClickTrading, preferences.defaultPerpUsd, preferences.defaultSpotUsd, selectAsset, send],
  );

  const confirm = useCallback(() => {
    const current = ticketRef.current;
    if (current) void send(current, false);
  }, [send]);

  const cancel = useCallback(() => setTicket(null), []);

  const setSizePreset = useCallback((index: number) => {
    setTicket((current) => {
      const size = current ? sizePresets[current.venue][index] : undefined;
      return current && size ? { ...current, sizeUsd: size } : current;
    });
  }, []);

  const value = useMemo(
    () => ({ ticket, pendingKey, press, confirm, cancel, setSizePreset, selectedNewsId, selectNews: setSelectedNewsId }),
    [ticket, pendingKey, press, confirm, cancel, setSizePreset, selectedNewsId],
  );
  return <TradeTicketContext.Provider value={value}>{children}</TradeTicketContext.Provider>;
}
