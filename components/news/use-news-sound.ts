"use client";

import { useEffect, useRef } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import { playAlertSound } from "@/lib/alerts/sounds";
import { pickNewsSound } from "@/lib/news/sound";
import type { NewsItem } from "@/lib/types";

/**
 * Plays a sound when headlines arrive that weren't in the feed before. Newness is tracked on everything the
 * server sends, so editing containers never counts as new news; only headlines the user can see make a sound.
 */
export function useNewsSound(items: NewsItem[], shownItems: NewsItem[], enabled: boolean) {
  const { preferences } = usePreferences();
  const seenRef = useRef<Set<string> | null>(null);
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const shownRef = useRef(shownItems);
  shownRef.current = shownItems;

  useEffect(() => {
    if (!enabled) return;
    if (!seenRef.current) {
      seenRef.current = new Set(items.map((item) => item.id));
      return;
    }
    const seen = seenRef.current;
    const freshIds = new Set(items.filter((item) => !seen.has(item.id)).map((item) => item.id));
    for (const id of freshIds) seen.add(id);
    if (freshIds.size === 0) return;

    const sound = pickNewsSound(
      shownRef.current.filter((item) => freshIds.has(item.id)),
      preferencesRef.current,
    );
    if (sound) playAlertSound(sound, preferencesRef.current.alertVolume);
  }, [items, enabled]);
}
