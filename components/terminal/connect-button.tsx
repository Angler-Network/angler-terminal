"use client";

import { Wallet } from "lucide-react";

/** Wallet connect comes later; the button holds its place in the top bar. */
export function ConnectButton() {
  return (
    <button
      type="button"
      title="Wallet connect is coming soon"
      className="inline-flex h-9 items-center gap-2 rounded-xl bg-app-accent px-4 text-[14px] font-medium text-app-on-accent transition-colors hover:bg-app-accent/85"
    >
      <Wallet className="size-4" aria-hidden />
      Connect
    </button>
  );
}
