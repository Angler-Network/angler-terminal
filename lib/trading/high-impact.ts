import type { NewsItem } from "@/lib/types";

/** Older items (e.g. from "Load older") never flash, even if their score is high. */
export const FRESH_WINDOW_MS = 10 * 60_000;

/**
 * Finds items that just became high impact: newly arrived, or a raw item whose enrichment pushed its score over the
 * threshold. The first call only records what's already there, so the initial history load stays quiet.
 * Mutates and returns `known`.
 */
export function detectHighImpact(
  known: Set<string> | null,
  items: Pick<NewsItem, "id" | "score" | "enriched" | "publishedAt">[],
  threshold: number,
  now = Date.now(),
) {
  const isHigh = (item: (typeof items)[number]) => item.enriched !== false && item.score >= threshold;
  if (!known) {
    return { known: new Set(items.filter(isHigh).map((item) => item.id)), fresh: [] as string[] };
  }
  const fresh: string[] = [];
  for (const item of items) {
    if (!isHigh(item) || known.has(item.id)) continue;
    known.add(item.id);
    if (item.publishedAt === undefined || now - item.publishedAt <= FRESH_WINDOW_MS) fresh.push(item.id);
  }
  return { known, fresh };
}

/** Whether a key event should be ignored by global shortcuts (typing in a field, or with modifiers). */
export function isTypingTarget(target: EventTarget | null, event: { metaKey: boolean; ctrlKey: boolean; altKey: boolean }) {
  if (event.metaKey || event.ctrlKey || event.altKey) return true;
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== "string") return false;
  return element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
}
