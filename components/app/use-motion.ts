"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";
import { durations, ease, ENTER_PROPS, freshKeys, motion, type Gsap } from "@/lib/motion";

type Animation = { revert: () => unknown };

/**
 * Plays `animate` when `active` turns true (or on mount). Reverted on cleanup, so a re-run (Strict Mode, fast
 * reopen) never leaves an element stuck mid-animation; without GSAP the element just shows.
 */
export function useEnter<T extends HTMLElement>(
  ref: RefObject<T | null>,
  animate: (gsap: Gsap, element: T) => Animation,
  active = true,
) {
  const animateRef = useRef(animate);
  animateRef.current = animate;
  useLayoutEffect(() => {
    const element = ref.current;
    const gsap = motion();
    if (!active || !element || !gsap) return;
    const animation = animateRef.current(gsap, element);
    return () => void animation.revert();
  }, [active, ref]);
}

/** Overlay dialogs: put the returned ref on the backdrop; its first child is the panel. */
export function useModalEnter<T extends HTMLElement = HTMLDivElement>(active: boolean) {
  const ref = useRef<T>(null);
  useEnter(
    ref,
    (gsap, backdrop) =>
      gsap
        .timeline()
        .from(backdrop, { opacity: 0, duration: durations.fast, ease: ease.soft, clearProps: ENTER_PROPS })
        .from(backdrop.firstElementChild, { opacity: 0, y: 14, scale: 0.97, duration: durations.base, ease: ease.out, clearProps: ENTER_PROPS }, 0),
    active,
  );
  return ref;
}

/** Native `<dialog>`s and popovers: a short rise and fade. */
export const riseIn = (gsap: Gsap, element: HTMLElement) =>
  gsap.from(element, { opacity: 0, y: 10, scale: 0.98, duration: durations.base, ease: ease.out, clearProps: ENTER_PROPS });

/**
 * Animates list items that arrive after the first render. Items are found with `selector` inside the container and
 * matched by `data-motion-key`, or by position in `keys` when they don't carry one.
 */
export function useListEnter(
  containerRef: RefObject<HTMLElement | null>,
  keys: readonly string[],
  selector: string,
  animate: (gsap: Gsap, elements: HTMLElement[]) => Animation,
) {
  const seenRef = useRef<Set<string> | null>(null);
  const animateRef = useRef(animate);
  animateRef.current = animate;
  // Stands for `keys` in the effect's dependencies.
  const signature = keys.join("\u0000");
  useLayoutEffect(() => {
    const fresh = freshKeys(seenRef.current, keys);
    seenRef.current = new Set(keys);
    const gsap = motion();
    const container = containerRef.current;
    if (fresh.length === 0 || !gsap || !container) return;
    const wanted = new Set(fresh);
    const elements = [...container.querySelectorAll<HTMLElement>(selector)].filter((element, index) =>
      wanted.has(element.dataset.motionKey ?? keys[index]),
    );
    if (elements.length === 0) return;
    const animation = animateRef.current(gsap, elements);
    return () => void animation.revert();
  }, [signature, containerRef, selector]);
}

/** Plays an exit (replacing any entrance still running), then calls `done`; right away without GSAP. */
export function animateOut(element: HTMLElement | null | undefined, vars: gsap.TweenVars, done: () => void) {
  const gsap = motion();
  if (!element || !gsap) return done();
  // The element is removed afterwards, so clipping it while it collapses needs no cleanup.
  element.style.overflow = "hidden";
  gsap.to(element, { duration: durations.fast, ease: ease.in, overwrite: true, ...vars, onComplete: done });
}
