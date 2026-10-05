"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useTrading } from "@/components/terminal/trading-provider";
import { usePreferences } from "./preferences-provider";

const loadSettings = () => import("./settings-dialog");
const loadSetup = () => import("@/components/terminal/trading-setup-dialog");

const SettingsDialog = dynamic(() => loadSettings().then((module) => module.SettingsDialog), { ssr: false });
const TradingSetupDialog = dynamic(() => loadSetup().then((module) => module.TradingSetupDialog), { ssr: false });

/** Mounts once `open` first turns true, and stays mounted so closing keeps its state. */
function useOpenedOnce(open: boolean) {
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (open) setOpened(true);
  }, [open]);
  return opened || open;
}

/**
 * Dialogs aren't part of the first load: their code is fetched when the browser is idle (so opening stays instant)
 * and they mount on first open.
 */
export function LazyDialogs() {
  const { isSettingsOpen } = usePreferences();
  const { isSetupOpen } = useTrading();
  const showSettings = useOpenedOnce(isSettingsOpen);
  const showSetup = useOpenedOnce(isSetupOpen);

  useEffect(() => {
    const prefetch = () => void Promise.all([loadSettings(), loadSetup()]).catch(() => {});
    const idle = "requestIdleCallback" in window ? window.requestIdleCallback(prefetch, { timeout: 5000 }) : null;
    const timer = idle === null ? window.setTimeout(prefetch, 3000) : null;
    return () => {
      if (idle !== null) window.cancelIdleCallback(idle);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  return (
    <>
      {showSettings && <SettingsDialog />}
      {showSetup && <TradingSetupDialog />}
    </>
  );
}
