"use client";

import { useEffect, useState } from "react";
import { hlConfig } from "@/lib/venues/hyperliquid/config";
import { ASTER_API_URL } from "@/lib/venues/aster/config";
import { extendedConfig } from "@/lib/venues/extended/config";
import { qfexConfig } from "@/lib/venues/qfex/config";
import { readQfexBook } from "@/lib/venues/qfex/markets";
import { lighterConfigs } from "@/lib/venues/lighter/config";
import type { VenueMarket } from "@/lib/venues/types";
import {
  readExtendedBook,
  readExtendedTrades,
  applyLevels,
  readAsterBook,
  readAsterTrades,
  readHlBook,
  readHlTrades,
  readLighterBook,
  readLighterTrades,
  sortedSide,
  type BookSide,
  type TapeTrade,
} from "@/lib/trading/orderbook";

const FLUSH_MS = 150;
const MAX_TRADES = 60;
const PING_MS = 45_000;
const RETRY_MS = 3_000;
const ASTER_POLL_MS = 1_000;
/** How long QFEX's market data socket may stay quiet before the REST book stands in. */
const QFEX_SILENT_MS = 3_000;

export type BookStatus = "connecting" | "live" | "offline";

/**
 * Live order book and trades for one venue market over a plain WebSocket (not the trading SDKs, so the first load
 * stays light). Updates are batched into one render every FLUSH_MS.
 */
export function useOrderBook(market: VenueMarket | null) {
  const [book, setBook] = useState<BookSide>({ bids: [], asks: [] });
  const [trades, setTrades] = useState<TapeTrade[]>([]);
  const [status, setStatus] = useState<BookStatus>("connecting");
  const key = market ? `${market.venue}:${market.coin}:${market.assetId}` : "";

  useEffect(() => {
    setBook({ bids: [], asks: [] });
    setTrades([]);
    if (!market) return;
    setStatus("connecting");
    if (market.venue === "aster") {
      // Aster: its public REST (open to browsers) read once a second: the book and the latest trades.
      let live = true;
      const poll = async () => {
        try {
          const [depth, recent] = await Promise.all([
            fetch(`${ASTER_API_URL}/fapi/v1/depth?symbol=${market.coin}&limit=100`, { cache: "no-store" }).then((response) => response.json()),
            fetch(`${ASTER_API_URL}/fapi/v1/trades?symbol=${market.coin}&limit=${MAX_TRADES}`, { cache: "no-store" }).then((response) => response.json()),
          ]);
          if (!live) return;
          const parsed = readAsterBook(depth);
          if (parsed) setBook(parsed);
          setTrades(readAsterTrades(recent).slice(0, MAX_TRADES));
          setStatus("live");
        } catch {
          if (live) setStatus("offline");
        }
      };
      void poll();
      const timer = window.setInterval(() => document.visibilityState !== "hidden" && void poll(), ASTER_POLL_MS);
      return () => {
        live = false;
        window.clearInterval(timer);
      };
    }
    if (market.venue === "qfex") {
      // QFEX: its public market data WebSocket (a 20-level book every 500ms, trades as they print), with our proxy's REST
      // book while the socket is silent (it can't open, or hasn't sent yet).
      let live = true;
      let stop = () => {};
      let lastStream = 0;
      let pending: TapeTrade[] = [];
      const flushTrades = window.setInterval(() => {
        if (pending.length === 0) return;
        const fresh = pending;
        pending = [];
        setTrades((current) => [...fresh, ...current].slice(0, MAX_TRADES));
      }, FLUSH_MS);
      const poll = async () => {
        if (Date.now() - lastStream < QFEX_SILENT_MS || document.visibilityState === "hidden") return;
        try {
          const response = await fetch(`${qfexConfig.proxy}/md/orderbook/${encodeURIComponent(market.coin)}`);
          const parsed = response.ok ? readQfexBook(await response.json()) : null;
          if (!live || Date.now() - lastStream < QFEX_SILENT_MS) return;
          if (parsed) setBook(parsed);
          setStatus(parsed ? "live" : "offline");
        } catch {
          if (live) setStatus("offline");
        }
      };
      void poll();
      const timer = window.setInterval(() => void poll(), ASTER_POLL_MS);
      void import("@/lib/venues/qfex/stream").then(({ watchQfex }) => {
        if (!live) return;
        stop = watchQfex(market.coin, {
          book: (next) => {
            lastStream = Date.now();
            setBook(next);
            setStatus("live");
          },
          trade: (trade) => {
            pending = [trade, ...pending];
          },
        });
      });
      return () => {
        live = false;
        stop();
        window.clearInterval(timer);
        window.clearInterval(flushTrades);
      };
    }
    if (market.venue === "extended") {
      // Extended: its REST book and trades through our proxy (no CORS there), cached 2s at the edge so every visitor
      // watching a market costs Extended one read.
      let live = true;
      const base = `${extendedConfig.proxy}/${extendedConfig.network}/api/v1/info/markets/${encodeURIComponent(market.coin)}`;
      const read = (path: string) => fetch(`${base}/${path}`).then(async (response) => (response.ok ? ((await response.json()) as { data?: unknown }).data : null));
      const poll = async () => {
        try {
          const [depth, recent] = await Promise.all([read("orderbook"), read("trades")]);
          if (!live) return;
          const parsed = readExtendedBook(depth);
          if (parsed) setBook(parsed);
          setTrades(readExtendedTrades(recent).slice(0, MAX_TRADES));
          setStatus(parsed ? "live" : "offline");
        } catch {
          if (live) setStatus("offline");
        }
      };
      void poll();
      const timer = window.setInterval(() => document.visibilityState !== "hidden" && void poll(), ASTER_POLL_MS);
      return () => {
        live = false;
        window.clearInterval(timer);
      };
    }
    if (market.venue === "orderly") {
      // Orderly: its shared public WebSocket (a full snapshot each second, trades as they print), loaded on demand.
      let live = true;
      let stop = () => {};
      let pending: TapeTrade[] = [];
      const flushTrades = window.setInterval(() => {
        if (pending.length === 0) return;
        const fresh = pending;
        pending = [];
        setTrades((current) => [...fresh, ...current].slice(0, MAX_TRADES));
      }, FLUSH_MS);
      void import("@/lib/venues/orderly/stream").then(({ watchOrderly }) => {
        if (!live) return;
        stop = watchOrderly(market.coin, {
          book: (next) => {
            setBook(next);
            setStatus("live");
          },
          trade: (trade) => {
            pending = [trade, ...pending];
          },
        });
      });
      return () => {
        live = false;
        stop();
        window.clearInterval(flushTrades);
      };
    }
    let socket: WebSocket | null = null;
    let isActive = true;
    let retry: number | undefined;
    let ping: number | undefined;
    // Lighter levels are kept across deltas; Hyperliquid replaces the whole book each time.
    const bids = new Map<number, number>();
    const asks = new Map<number, number>();
    let pendingBook: BookSide | null = null;
    let pendingTrades: TapeTrade[] = [];

    const flush = window.setInterval(() => {
      if (pendingBook) setBook(pendingBook);
      if (pendingTrades.length > 0) {
        const fresh = pendingTrades;
        setTrades((current) => [...fresh, ...current].slice(0, MAX_TRADES));
      }
      pendingBook = null;
      pendingTrades = [];
    }, FLUSH_MS);

    const isHl = market.venue === "hyperliquid";
    const url = market.venue === "hyperliquid" ? `${hlConfig.apiUrl.replace(/^http/, "ws")}/ws` : lighterConfigs[market.venue].wsUrl;

    const onMessage = (event: MessageEvent) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (isHl) {
        if (message.channel === "l2Book") {
          const next = readHlBook(message.data);
          if (next) pendingBook = next;
        } else if (message.channel === "trades") {
          // Newest first, like the tape shows them.
          pendingTrades = [...readHlTrades(message.data).reverse(), ...pendingTrades];
        }
        return;
      }
      const type = String(message.type ?? "");
      if (type.endsWith("/order_book")) {
        const changes = readLighterBook(message);
        if (!changes) return;
        if (type.startsWith("subscribed/")) {
          bids.clear();
          asks.clear();
        }
        applyLevels(bids, changes.bids);
        applyLevels(asks, changes.asks);
        pendingBook = { bids: sortedSide(bids, "bids"), asks: sortedSide(asks, "asks") };
      } else if (type.endsWith("/trade")) {
        const fresh = readLighterTrades(message).sort((a, b) => b.time - a.time);
        pendingTrades = type.startsWith("subscribed/") ? fresh : [...fresh, ...pendingTrades];
      }
    };

    const connect = () => {
      if (!isActive) return;
      const ws = new WebSocket(url);
      socket = ws;
      ws.onopen = () => {
        setStatus("live");
        if (isHl) {
          ws.send(JSON.stringify({ method: "subscribe", subscription: { type: "l2Book", coin: market.coin } }));
          ws.send(JSON.stringify({ method: "subscribe", subscription: { type: "trades", coin: market.coin } }));
        } else {
          ws.send(JSON.stringify({ type: "subscribe", channel: `order_book/${market.assetId}` }));
          ws.send(JSON.stringify({ type: "subscribe", channel: `trade/${market.assetId}` }));
        }
        ping = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(isHl ? { method: "ping" } : { type: "ping" }));
        }, PING_MS);
      };
      ws.onmessage = onMessage;
      ws.onclose = () => {
        window.clearInterval(ping);
        if (!isActive) return;
        setStatus("offline");
        retry = window.setTimeout(connect, RETRY_MS);
      };
      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      isActive = false;
      window.clearInterval(flush);
      window.clearInterval(ping);
      window.clearTimeout(retry);
      socket?.close();
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return { book, trades, status };
}
