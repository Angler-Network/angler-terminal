/**
 * GSAP, kept out of the first load: `loadMotion()` fetches it (the app asks once the browser is idle) and every
 * animation is optional. Until GSAP has loaded, or when the system asks for reduced motion, `motion()` returns null
 * and elements simply appear in their final state, so no content ever waits on an animation.
 */
import type { gsap as GsapType } from "gsap";

export type Gsap = typeof GsapType;

let instance: Gsap | null = null;
let pending: Promise<Gsap | null> | null = null;

export function loadMotion(): Promise<Gsap | null> {
  pending ??= import("gsap")
    .then((module) => (instance = module.gsap))
    .catch(() => {
      pending = null;
      return null;
    });
  return pending;
}

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** GSAP when it's loaded and motion is allowed; null means "show the end state at once". */
export function motion(): Gsap | null {
  return instance && !prefersReducedMotion() ? instance : null;
}

/** Shared timing so every surface moves the same way. */
export const durations = { fast: 0.18, base: 0.28, slow: 0.4 } as const;
export const ease = { out: "power3.out", in: "power2.in", soft: "power2.out" } as const;

/**
 * Inline styles an entrance leaves behind, cleared when it ends: a leftover transform would turn the element into
 * the containing block of its `position: fixed` children (dropdowns, popovers) and give it a stacking context.
 */
export const ENTER_PROPS = "opacity,transform,translate,rotate,scale";

/** Lists animate only a few arrivals at once: a burst (first load, reconnect) just appears. */
export const MAX_ANIMATED_ARRIVALS = 4;

/**
 * Keys that weren't in the previous render, or none when there was no previous render (first paint never animates)
 * or the burst is larger than `max`.
 */
export function freshKeys(previous: ReadonlySet<string> | null, keys: readonly string[], max = MAX_ANIMATED_ARRIVALS): string[] {
  if (!previous) return [];
  const fresh = keys.filter((key) => !previous.has(key));
  return fresh.length > max ? [] : fresh;
}
