"use client";

import type { BookSide, TapeTrade } from "@/lib/trading/orderbook";
import { orderlyConfig } from "./config";
import { readOrderlyBook, readOrderlyTrade } from "./markets";

/**
 * Orderly's public market data over one shared WebSocket (its REST order book needs a signed account): the
 * `{symbol}@orderbook` stream (a full depth-100 snapshot every second) and `{symbol}@trade`. Topics are subscribed while
 * someone listens and dropped a minute after the last one leaves; the socket answers Orderly's pings and reconnects.
 * The URL path takes an account id, and Orderly now closes the socket (1000) on any id it doesn't know ("angler-public"
 * worked until October 2026): `orderlyConfig.streamIds` lists ours (when set) and the docs' example, and a socket closed
 * before its first message moves on to the next id.
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
let tradeCount = 0;
let streamIndex = 0;

function send(message: Record<string, unknown>) {
  if (socket && open) socket.send(JSON.stringify(message));
}

function subscribe(topic: string) {
  if (subscribed.has(topic)) return;
  subscribed.add(topic);
  send({ id: topic, topic, event: "subscribe" });
}

function connect() {
  if (socket || typeof WebSocket === "undefined") return;
  const ids = orderlyConfig.streamIds;
  const ws = new WebSocket(`${orderlyConfig.wsUrl}/${ids[streamIndex % ids.length]}`);
  socket = ws;
  let heard = false;
  ws.onopen = () => {
    open = true;
    const topics = [...subscribed];
    subscribed.clear();
    for (const topic of topics) subscribe(topic);
  };
  ws.onmessage = (event) => {
    heard = true;
    let message: { event?: string; topic?: string; ts?: number; data?: unknown };
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (message.event === "ping") return send({ event: "pong", ts: Date.now() });
    const topic = message.topic;
    if (!topic) return;
    const [symbol, kind] = topic.split("@");
    const set = listeners.get(symbol);
    if (kind === "orderbook") {
      const book = readOrderlyBook(message.data);
      if (!book) return;
      latest.set(symbol, book);
      set?.forEach((listener) => listener.book?.(book));
    } else if (kind === "trade") {
      const trade = readOrderlyTrade(message.data, message.ts ?? Date.now(), `orderly-${symbol}-${(tradeCount += 1)}`);
      if (trade) set?.forEach((listener) => listener.trade?.(trade));
    }
  };
  ws.onclose = () => {
    socket = null;
    open = false;
    // Closed before saying anything: the id was refused, so the next connect tries the next one.
    if (!heard) streamIndex += 1;
    // Topics stay in `subscribed`, so a reconnect resubscribes them.
    if (listeners.size > 0) setTimeout(connect, RETRY_MS);
  };
  ws.onerror = () => ws.close();
}

/** Listens to a symbol's book (and trades, when asked). Returns the unsubscribe function. */
export function watchOrderly(symbol: string, listener: Listener) {
  let set = listeners.get(symbol);
  if (!set) listeners.set(symbol, (set = new Set()));
  set.add(listener);
  clearTimeout(idle.get(symbol));
  connect();
  subscribe(`${symbol}@orderbook`);
  if (listener.trade) subscribe(`${symbol}@trade`);
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
        for (const topic of [`${symbol}@orderbook`, `${symbol}@trade`]) {
          if (subscribed.delete(topic)) send({ id: topic, topic, event: "unsubscribe" });
        }
      }, IDLE_UNSUBSCRIBE_MS),
    );
  };
}

/** One look at a symbol's book: the latest snapshot, waiting up to `timeoutMs` for the first. */
export function orderlyBookSnapshot(symbol: string, timeoutMs = 3_000): Promise<BookSide | null> {
  return new Promise((resolve) => {
    let done = false;
    let stop = () => {};
    const finish = (book: BookSide | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // Keep the topic warm for the next refresh (the idle timer drops it later).
      setTimeout(() => stop(), 0);
      resolve(book);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    stop = watchOrderly(symbol, { book: (book) => finish(book) });
  });
}
