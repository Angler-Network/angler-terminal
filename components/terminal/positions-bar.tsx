"use client";

import { useState } from "react";

const tabs = ["Positions", "Open orders", "Fills"] as const;

/** Placeholder: fills in once a wallet is connected. */
export function PositionsBar() {
  const [tab, setTab] = useState<(typeof tabs)[number]>("Positions");

  return (
    <section
      aria-label="Account"
      className="surface-panel flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-app-card/80 bg-app-card/55"
    >
      <div role="tablist" className="flex shrink-0 items-center gap-4 border-b border-app-hairline px-3">
        {tabs.map((name) => (
          <button
            key={name}
            role="tab"
            type="button"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
            className={`-mb-px h-9 border-b-2 text-[12px] font-semibold transition-colors ${
              tab === name ? "border-app-accent text-app-ink" : "border-transparent text-app-muted hover:text-app-ink"
            }`}
          >
            {name}
            <span className="ml-1.5 tabular-nums text-app-faint">0</span>
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center text-[12px] text-app-muted">
        Connect a wallet to see your {tab.toLowerCase()}.
      </div>
    </section>
  );
}
