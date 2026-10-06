"use client";

import { useEffect, useRef } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import { useToast } from "@/components/app/toast-provider";
import { notificationsGranted, notifyNews } from "@/lib/alerts/notify";
import { matchRules, type PositionSide, type RuleMatch } from "@/lib/news/rules";
import { detectHighImpact } from "@/lib/trading/high-impact";
import type { NewsItem } from "@/lib/types";
import { useTradeTicket } from "./trade-ticket";
import { useTrading } from "./trading-provider";
import { useNewsTrader } from "./use-news-trader";

/** A rule fires at most once per this window, so a burst of headlines can't stack trades. */
const ALERT_COOLDOWN_MS = 60_000;
const TRADE_COOLDOWN_MS = 5 * 60_000;
const PROMPT_MS = 20_000;

/**
 * Runs the user's news rules on fresh enriched items while the terminal is open: alerts, perp trades through the
 * news trader (same guards, routing and analytics) and position closes. Trades ask with a one-press prompt unless
 * the rule is automatic.
 */
export function NewsRulesRunner({ items }: { items: NewsItem[] }) {
  const { preferences } = usePreferences();
  const toast = useToast();
  const trade = useNewsTrader();
  const { selectNews } = useTradeTicket();
  const { account, closePosition } = useTrading();
  const knownRef = useRef<Set<string> | null>(null);
  const firedRef = useRef(new Map<string, number>());
  // The effect runs on new items only; everything else is read through this ref.
  const live = useRef({ rules: preferences.newsRules, toast, trade, selectNews, account, closePosition, oneClick: preferences.oneClickTrading });
  live.current = { rules: preferences.newsRules, toast, trade, selectNews, account, closePosition, oneClick: preferences.oneClickTrading };

  useEffect(() => {
    if (items.length === 0 && !knownRef.current) return;
    const { known, fresh } = detectHighImpact(knownRef.current, items, 0);
    knownRef.current = known;
    const { rules } = live.current;
    if (fresh.length === 0 || !rules.some((rule) => rule.enabled)) return;

    const positions: Record<string, PositionSide> = {};
    for (const position of live.current.account?.positions ?? []) positions[position.symbol] = position.size > 0 ? "long" : "short";

    for (const id of fresh) {
      const item = items.find((entry) => entry.id === id);
      if (!item) continue;
      for (const match of matchRules(rules, item, positions)) run(match, item);
    }
  }, [items]);

  function run(match: RuleMatch, item: NewsItem) {
    const { toast, trade, selectNews, account, closePosition, oneClick } = live.current;
    const { rule, symbol } = match;
    const key = `${rule.id}:${rule.action === "close" ? symbol : ""}`;
    const cooldown = rule.action === "alert" ? ALERT_COOLDOWN_MS : TRADE_COOLDOWN_MS;
    const last = firedRef.current.get(key) ?? 0;
    if (Date.now() - last < cooldown) return;
    firedRef.current.set(key, Date.now());
    const headline = item.headline.length > 90 ? `${item.headline.slice(0, 87)}…` : item.headline;

    if (rule.action === "alert") {
      toast({ tone: "info", title: `News rule: ${symbol} (${item.score})`, message: headline, durationMs: PROMPT_MS, action: { label: "Show", onClick: () => selectNews(item.id) } });
      if (notificationsGranted()) notifyNews(item, selectNews);
      return;
    }

    if (rule.action === "close") {
      const held = (account?.positions ?? []).filter((position) => position.symbol === symbol);
      if (held.length === 0) return;
      const close = async () => {
        for (const position of held) await closePosition(position);
      };
      if (rule.auto) {
        toast({ tone: "info", title: `News rule: closing ${symbol}`, message: headline });
        void close();
      } else {
        toast({ tone: "info", title: `News rule: close ${symbol}?`, message: headline, durationMs: PROMPT_MS, action: { label: `Close ${symbol}`, onClick: () => void close() } });
      }
      return;
    }

    const side = rule.action === "long" ? "buy" : "sell";
    const place = () => void trade({ symbol, venue: "perp", side, sizeUsd: rule.sizeUsd, newsId: item.id, oneClick: rule.auto || oneClick });
    const label = `${rule.action === "long" ? "Long" : "Short"} $${rule.sizeUsd} ${symbol}`;
    if (rule.auto) {
      toast({ tone: "info", title: `News rule: ${label}`, message: headline });
      place();
    } else {
      toast({ tone: "info", title: `News rule: ${label}?`, message: headline, durationMs: PROMPT_MS, action: { label, onClick: place } });
    }
  }

  return null;
}
