import type { NewsItem } from "@/lib/types";

/**
 * News rules: "when news like this arrives, do that". Matching is pure and unit-tested; the terminal runs the
 * actions (alert, open a perp position, close positions) while the tab is open, asking first unless the rule is
 * set to run on its own.
 */

/** Any asset, assets the user holds a position in, or one ticker. */
export type RuleAsset = "*" | "positions" | (string & {});
/** "adverse" = against the user's position: bearish for a long, bullish for a short. */
export type RuleSentiment = "any" | "positive" | "negative" | "adverse";
export type RuleAction = "alert" | "long" | "short" | "close";

export interface NewsRule {
  id: string;
  enabled: boolean;
  asset: RuleAsset;
  minImpact: number;
  sentiment: RuleSentiment;
  action: RuleAction;
  /** USD size for long/short. */
  sizeUsd: number;
  /** Run without asking (trades only). Off: the terminal shows a one-press prompt. */
  auto: boolean;
}

export type PositionSide = "long" | "short";

export interface RuleMatch {
  rule: NewsRule;
  symbol: string;
  /** The user's position on the symbol, when there is one. */
  position?: PositionSide;
}

export const MAX_RULES = 20;
const NEUTRAL = 0.15;
const SYMBOL_PATTERN = /^[A-Z0-9]{1,20}$/;
const ASSETS = new Set(["*", "positions"]);
const SENTIMENTS = new Set<RuleSentiment>(["any", "positive", "negative", "adverse"]);
const ACTIONS = new Set<RuleAction>(["alert", "long", "short", "close"]);

type RuleItem = Pick<NewsItem, "enriched" | "score" | "coins" | "sentiment" | "hasSentiment" | "predictions">;

/**
 * Which way the news points for one asset: its own impact prediction first, else the item's sentiment.
 * 0 when neither says (REST items carry no sentiment or predictions).
 */
export function newsDirection(item: RuleItem, symbol: string) {
  const prediction = item.predictions?.find((entry) => entry.symbol === symbol);
  if (prediction) return prediction.direction === "+" ? 1 : -1;
  if (item.hasSentiment === false) return 0;
  return item.sentiment >= NEUTRAL ? 1 : item.sentiment <= -NEUTRAL ? -1 : 0;
}

function sentimentMatches(sentiment: RuleSentiment, direction: number, position: PositionSide | undefined) {
  if (sentiment === "any") return true;
  if (sentiment === "positive") return direction > 0;
  if (sentiment === "negative") return direction < 0;
  return position === "long" ? direction < 0 : position === "short" ? direction > 0 : false;
}

/**
 * The assets of `item` a rule fires for. Close rules fire once per held asset; other actions fire for the first
 * matching asset only, so one headline opens at most one position per rule.
 */
export function matchRule(rule: NewsRule, item: RuleItem, positions: Record<string, PositionSide>): RuleMatch[] {
  if (!rule.enabled || !item.enriched || item.score < rule.minImpact) return [];
  const matches: RuleMatch[] = [];
  for (const symbol of item.coins ?? []) {
    const position = positions[symbol];
    if (rule.asset === "positions" && !position) continue;
    if (rule.asset !== "*" && rule.asset !== "positions" && rule.asset !== symbol) continue;
    if (rule.action === "close" && !position) continue;
    if (!sentimentMatches(rule.sentiment, newsDirection(item, symbol), position)) continue;
    matches.push({ rule, symbol, position });
    if (rule.action !== "close") break;
  }
  return matches;
}

/** Every rule's matches for one item. */
export function matchRules(rules: NewsRule[], item: RuleItem, positions: Record<string, PositionSide>) {
  return rules.flatMap((rule) => matchRule(rule, item, positions));
}

/** Validates the saved `newsRules` preference. */
export function readNewsRules(value: unknown): NewsRule[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((entry): NewsRule[] => {
      const record = (entry ?? {}) as Record<string, unknown>;
      const asset = typeof record.asset === "string" ? record.asset.toUpperCase() : "";
      const normalizedAsset = record.asset === "*" || record.asset === "positions" ? record.asset : asset;
      const minImpact = Number(record.minImpact);
      const sizeUsd = Number(record.sizeUsd);
      if (
        typeof record.id !== "string" ||
        !(ASSETS.has(normalizedAsset as string) || SYMBOL_PATTERN.test(normalizedAsset as string)) ||
        !SENTIMENTS.has(record.sentiment as RuleSentiment) ||
        !ACTIONS.has(record.action as RuleAction) ||
        !Number.isFinite(minImpact)
      ) {
        return [];
      }
      return [
        {
          id: record.id.slice(0, 40),
          enabled: record.enabled !== false,
          asset: normalizedAsset as RuleAsset,
          minImpact: Math.min(100, Math.max(0, Math.round(minImpact))),
          sentiment: record.sentiment as RuleSentiment,
          action: record.action as RuleAction,
          sizeUsd: Number.isFinite(sizeUsd) && sizeUsd > 0 ? Math.round(sizeUsd * 100) / 100 : 0,
          auto: record.auto === true,
        },
      ];
    })
    .slice(0, MAX_RULES);
}

const sentimentText: Record<RuleSentiment, string> = {
  any: "",
  positive: "bullish ",
  negative: "bearish ",
  adverse: "adverse ",
};

/** One-line summary, e.g. "Bearish BTC news, impact 80+ → close position (asks first)". */
export function describeRule(rule: NewsRule) {
  const asset = rule.asset === "*" ? "any asset" : rule.asset === "positions" ? "my positions" : rule.asset;
  const subject = `${sentimentText[rule.sentiment]}news on ${asset}, impact ${rule.minImpact}+`;
  const action =
    rule.action === "alert"
      ? "alert me"
      : rule.action === "close"
        ? "close the position"
        : `${rule.action} $${rule.sizeUsd}`;
  const mode = rule.action === "alert" ? "" : rule.auto ? " (automatic)" : " (asks first)";
  return `${subject.charAt(0).toUpperCase()}${subject.slice(1)} → ${action}${mode}`;
}
