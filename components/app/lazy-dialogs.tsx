"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useTrading } from "@/components/terminal/trading-provider";
import { loadMotion } from "@/lib/motion";
import { usePreferences } from "./preferences-provider";

const loadSettings = () => import("./settings-dialog");
const loadSetup = () => import("@/components/terminal/trading-setup-dialog");
const loadDeposit = () => import("@/components/terminal/deposit-dialog");
const loadProOrder = () => import("@/components/terminal/pro-order-dialog");

const SettingsDialog = dynamic(() => loadSettings().then((module) => module.SettingsDialog), { ssr: false });
const TradingSetupDialog = dynamic(() => loadSetup().then((module) => module.TradingSetupDialog), { ssr: false });
const DepositDialog = dynamic(() => loadDeposit().then((module) => module.DepositDialog), { ssr: false });
const ProOrderDialog = dynamic(() => loadProOrder().then((module) => module.ProOrderDialog), { ssr: false });

/** Mounts once `open` first turns true, and stays mounted so closing keeps its state. */
function useOpenedOnce(open: boolean) {
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (open) setOpened(true);
  }, [open]);
  return opened || open;
}

const MOTION_DELAY_MS = 6000;

/**
 * GSAP (`lib/motion.ts`) loads on the first press or key, or once the page has settled, so it never competes with
 * the first render on slow phones. Until then nothing animates.
 */
function useMotionPreload() {
  useEffect(() => {
    let idle: number | null = null;
    const events = ["pointerdown", "keydown"] as const;
    const load = () => {
      stop();
      void loadMotion();
    };
    const stop = () => {
      window.clearTimeout(timer);
      if (idle !== null) window.cancelIdleCallback(idle);
      for (const name of events) window.removeEventListener(name, load);
    };
    for (const name of events) window.addEventListener(name, load, { passive: true });
    const timer = window.setTimeout(() => {
      if ("requestIdleCallback" in window) idle = window.requestIdleCallback(load, { timeout: 4000 });
      else load();
    }, MOTION_DELAY_MS);
    return stop;
  }, []);
}

/**
 * Dialogs aren't part of the first load: their code is fetched when the browser is idle (so opening stays instant)
 * and they mount on first open.
 */
export function LazyDialogs() {
  const { isSettingsOpen } = usePreferences();
  const { isSetupOpen, depositVenue, isProOrderOpen } = useTrading();
  const showSettings = useOpenedOnce(isSettingsOpen);
  const showSetup = useOpenedOnce(isSetupOpen);
  const showDeposit = useOpenedOnce(depositVenue !== null);
  const showProOrder = useOpenedOnce(isProOrderOpen);

  useEffect(() => {
    const prefetch = () => void Promise.all([loadSettings(), loadSetup()]).catch(() => {});
    const idle = "requestIdleCallback" in window ? window.requestIdleCallback(prefetch, { timeout: 5000 }) : null;
    const timer = idle === null ? window.setTimeout(prefetch, 3000) : null;
    return () => {
      if (idle !== null) window.cancelIdleCallback(idle);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  useMotionPreload();

  return (
    <>
      {showSettings && <SettingsDialog />}
      {showSetup && <TradingSetupDialog />}
      {showDeposit && <DepositDialog />}
      {showProOrder && <ProOrderDialog />}
    </>
  );
}
