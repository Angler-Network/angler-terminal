import type { AlertSound, Preferences } from "@/lib/preferences";
import type { NewsItem } from "@/lib/types";

type NewsSoundPreferences = Pick<
  Preferences,
  | "newsSound"
  | "newsSoundMinImpact"
  | "newsSoundBySentiment"
  | "newsSoundPositive"
  | "newsSoundNegative"
  | "newsSoundSentimentThreshold"
>;

/** The sound a new headline should play, or null when it should stay quiet. */
export function newsSoundFor(item: Pick<NewsItem, "score" | "sentiment">, preferences: NewsSoundPreferences): AlertSound | null {
  if (preferences.newsSound === "none" || item.score < preferences.newsSoundMinImpact) return null;
  if (preferences.newsSoundBySentiment) {
    if (item.sentiment >= preferences.newsSoundSentimentThreshold) return preferences.newsSoundPositive;
    if (item.sentiment <= -preferences.newsSoundSentimentThreshold) return preferences.newsSoundNegative;
  }
  return preferences.newsSound;
}

/** Of several headlines arriving together, the one whose sound should play: the highest impact that is allowed to sound. */
export function pickNewsSound(items: Pick<NewsItem, "score" | "sentiment">[], preferences: NewsSoundPreferences) {
  let best: { score: number; sound: AlertSound } | null = null;
  for (const item of items) {
    const sound = newsSoundFor(item, preferences);
    if (sound && sound !== "none" && (!best || item.score > best.score)) best = { score: item.score, sound };
  }
  return best?.sound ?? null;
}
