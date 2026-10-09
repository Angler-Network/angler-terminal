"use client";

/**
 * Whether the user is still at the screen. Swap quotes refresh every 10-15s through our API keys, and a card left open
 * with an amount typed kept asking all night: refreshes pause after IDLE_MS without a press, key, scroll or pointer
 * move, and the first sign of the user back refreshes at once (`onUserBack`). Quotes are fetched again before signing
 * anyway, so a paused one is never traded on.
 */

export const IDLE_MS = 2 * 60_000;
const EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;

let last = Date.now();
let idle = false;
let started = false;
const wakers = new Set<() => void>();

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  const mark = () => {
    last = Date.now();
    if (!idle) return;
    idle = false;
    wakers.forEach((wake) => wake());
  };
  for (const type of EVENTS) window.addEventListener(type, mark, { passive: true, capture: true });
  window.addEventListener("focus", mark);
}

/** True once nobody has touched the page for IDLE_MS. */
export function userIdle() {
  start();
  idle = Date.now() - last > IDLE_MS;
  return idle;
}

/** Calls `wake` when the user comes back after being idle; returns the unsubscribe function. */
export function onUserBack(wake: () => void) {
  start();
  wakers.add(wake);
  return () => {
    wakers.delete(wake);
  };
}
