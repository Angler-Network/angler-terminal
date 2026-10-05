"use client";

import { useEffect, useRef } from "react";
import { useToast } from "@/components/app/toast-provider";
import type { TradeVenueKind } from "@/lib/trading/presets";
import type { OrderSide } from "@/lib/venues/types";
import { useTradeTicket, type TradeTicket } from "./trade-ticket";

const LOADING_TIMEOUT_MS = 10_000;

export type PanelStatus = { state: "ready" } | { state: "loading" } | { state: "blocked"; reason: string };

interface Binding {
  venue: TradeVenueKind;
  symbol: string;
  /** Current panel values, so a confirmed ticket only fires once the panel shows exactly what will be sent. */
  current: { side: OrderSide; sizeUsd: number };
  apply: (side: OrderSide, sizeUsd: number) => void;
  status: PanelStatus;
  /** Places the order; resolves to whether it was placed. */
  submit: (ticket: TradeTicket) => Promise<boolean>;
}

/** Connects the active order panel to the news trade ticket. Returns the ticket when it targets this panel. */
export function useTicketBinding({ venue, symbol, current, apply, status, submit }: Binding) {
  const toast = useToast();
  const { ticket, settle } = useTradeTicket();
  const mine = ticket && ticket.venue === venue && ticket.symbol === symbol ? ticket : null;
  const handled = useRef<{ id: number; nonce: number } | null>(null);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const submitRef = useRef(submit);
  submitRef.current = submit;

  useEffect(() => {
    if (mine) applyRef.current(mine.side, mine.sizeUsd);
  }, [mine?.id, mine?.side, mine?.sizeUsd]); // eslint-disable-line react-hooks/exhaustive-deps

  const matches = mine !== null && current.side === mine.side && current.sizeUsd === mine.sizeUsd;

  useEffect(() => {
    if (!mine || mine.confirmNonce === 0) return;
    const done = handled.current;
    if (done && done.id === mine.id && done.nonce >= mine.confirmNonce) return;
    if (!matches || status.state === "loading") {
      const timer = window.setTimeout(() => {
        handled.current = { id: mine.id, nonce: mine.confirmNonce };
        toast({ tone: "error", title: "Order not placed", message: "The order panel is still loading. Try again in a moment." });
      }, LOADING_TIMEOUT_MS);
      return () => window.clearTimeout(timer);
    }
    handled.current = { id: mine.id, nonce: mine.confirmNonce };
    if (status.state === "blocked") {
      toast({ tone: "error", title: "Order not placed", message: status.reason });
      return;
    }
    void submitRef.current(mine).finally(() => settle(mine.id));
  }, [mine, matches, status, toast, settle]);

  return mine;
}
