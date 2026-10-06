import type { NewsItem } from "@/lib/types";

/** Browser notification text for a high-impact news item. Pure, unit-tested. */
export function notificationContent(item: Pick<NewsItem, "headline" | "severity" | "score" | "coins" | "sentiment" | "hasSentiment">) {
  const coins = (item.coins ?? []).slice(0, 3).join(", ");
  const tone = item.hasSentiment === false ? "" : item.sentiment >= 0.15 ? " · Bullish" : item.sentiment <= -0.15 ? " · Bearish" : "";
  return {
    title: `${item.severity.charAt(0).toUpperCase()}${item.severity.slice(1)}${coins ? ` · ${coins}` : ""}${tone}`,
    body: `${item.headline} (impact ${item.score})`,
  };
}

/** Whether notifications can be shown at all in this browser right now. */
export function notificationsGranted() {
  return typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted";
}

/**
 * Shows a notification for a fresh high-impact item while the terminal is in a background tab (in the foreground
 * the card flash is enough). Clicking it brings the tab back and selects the item.
 */
export function notifyNews(item: NewsItem, onOpen: (id: string) => void) {
  if (!notificationsGranted() || document.visibilityState === "visible") return;
  const { title, body } = notificationContent(item);
  try {
    const notification = new Notification(title, { body, icon: "/logo.png", tag: `news-${item.id}` });
    notification.onclick = () => {
      window.focus();
      onOpen(item.id);
      notification.close();
    };
  } catch {
    // Some mobile browsers only allow notifications from a service worker; the in-page flash still shows.
  }
}
