"use client";

import type { BookSide, TapeTrade } from "@/lib/trading/orderbook";
import { qfexConfig } from "./config";
import { readQfexBook, readQfexTrade } from "./markets";

/**
 * QFEX's public market data over one shared WebSocket (`wss://mds.qfex.com`, open to browsers): the `level2` channel (a
 * 20-level snapshot every 500ms) and `trade`. Symbols are subscribed while someone listens and dropped a minute after the
 * last one leaves; the socket reconnects and resubscribes.
 */

type Listener = { book?: (book: BookSide) => void; trade?: (trade: TapeTrade) => void };

const RETRY_MS = 3_000;
const IDLE_UNSUBSCRIBE_MS = 60_000;

let socket: WebSocket | null = null;
let open = false;
const listeners = new Map<string, Set<Listener>>();
const latest = new Map<string, BookSide>();
const subscribed = new Set<string>();
const idle = new Map<string, ReturnType<typeof setTimeout>>();

function send(message: Record<string, unknown>) {
  if (socket && open) socket.send(JSON.stringify(message));
}

function subscribe(symbol: string) {
  if (subscribed.has(symbol)) return;
  subscribed.add(symbol);
  send({ type: "subscribe", channels: ["level2", "trade"], symbols: [symbol] });
}

function connect() {
  if (socket || typeof WebSocket === "undefined") return;
  const ws = new WebSocket(qfexConfig.marketWs);
  socket = ws;
  ws.onopen = () => {
    open = true;
    const symbols = [...subscribed];
    subscribed.clear();
    for (const symbol of symbols) subscribe(symbol);
  };
  ws.onmessage = (event) => {
    let message: { type?: string; symbol?: string } & Record<string, unknown>;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (!message.symbol) return;
    const set = listeners.get(message.symbol);
    if (message.type === "level2") {
      const book = readQfexBook(message);
      if (!book) return;
      latest.set(message.symbol, book);
      set?.forEach((listener) => listener.book?.(book));
    } else if (message.type === "trade") {
      const trade = readQfexTrade(message);
      if (trade) set?.forEach((listener) => listener.trade?.(trade));
    }
  };
  ws.onclose = () => {
    socket = null;
    open = false;
    // Symbols stay in `subscribed`, so a reconnect resubscribes them.
    if (listeners.size > 0) setTimeout(connect, RETRY_MS);
  };
  ws.onerror = () => ws.close();
}

/** Listens to a symbol's book and trades. Returns the unsubscribe function. */
export function watchQfex(symbol: string, listener: Listener) {
  let set = listeners.get(symbol);
  if (!set) listeners.set(symbol, (set = new Set()));
  set.add(listener);
  clearTimeout(idle.get(symbol));
  connect();
  subscribe(symbol);
  const known = latest.get(symbol);
  if (known) listener.book?.(known);
  return () => {
    set.delete(listener);
    if (set.size > 0) return;
    idle.set(
      symbol,
      setTimeout(() => {
        if (listeners.get(symbol)?.size) return;
        listeners.delete(symbol);
        latest.delete(symbol);
        if (subscribed.delete(symbol)) send({ type: "unsubscribe", channels: ["level2", "trade"], symbols: [symbol] });
      }, IDLE_UNSUBSCRIBE_MS),
    );
  };
}
