"use client";

import Image from "next/image";
import Link from "next/link";
import { ConnectButton } from "@/components/terminal/connect-button";
import { deployment, otherDeploymentUrl } from "@/lib/deployment";
import { SidebarToggle, TopBarToggle } from "./layout-toggles";
import { MobileNav } from "./mobile-nav";
import { MobileViewProvider } from "./mobile-view";
import { usePreferences } from "./preferences-provider";
import { TopNav } from "./top-nav";

/** The testnet site says so in the top bar and links to the mainnet one. */
function TestnetBadge() {
  const label = "Testnet";
  const className = "inline-flex h-8 items-center rounded-lg bg-[#f5c97b]/15 px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#f5c97b]";
  return otherDeploymentUrl ? (
    <a href={otherDeploymentUrl} title="Test funds only. Open the mainnet site" className={`${className} hover:bg-[#f5c97b]/25`}>
      {label}
    </a>
  ) : (
    <span title="Test funds only" className={className}>
      {label}
    </span>
  );
}

/**
 * Top bar, page and optional footer. The server-rendered price tape is placed once, where `tapePosition` puts it:
 * in the top bar, in a footer strip, or nowhere. With `navMode: "top"` the top bar also carries the navigation.
 * Below `lg` the rail is replaced by a bottom tab bar (`mobile-nav.tsx`).
 */
export function AppFrame({ tape, children }: { tape: React.ReactNode; children: React.ReactNode }) {
  const { preferences, isLoaded } = usePreferences();
  // Before preferences load, render the default spot; html[data-tape] keeps it hidden for other choices.
  const position = isLoaded ? preferences.tapePosition : "top";

  return (
    <MobileViewProvider>
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="app-topbar surface-chrome flex h-14 shrink-0 items-center gap-3 border-b border-app-hairline px-3 sm:px-4">
        {/* The rail carries the logo; the top bar shows it on small screens and in top navigation. */}
        <Link href="/" aria-label="Angler Terminal" className="flex shrink-0 lg:hidden [html[data-nav=top]_&]:flex">
          <Image src="/blacklogo.png" alt="Angler" width={28} height={28} className="[html[data-tone=dark]_&]:hidden" />
          <Image src="/whitelogo.png" alt="" aria-hidden width={28} height={28} priority className="hidden [html[data-tone=dark]_&]:block" />
        </Link>
        <span className="app-sidebar-toggle contents">
          <SidebarToggle />
        </span>
        <TopNav />
        {position === "top" ? <div className="app-tape-top flex min-w-0 flex-1">{tape}</div> : <div className="flex-1" />}
        <div className="flex shrink-0 items-center gap-2 lg:border-l lg:border-app-hairline lg:pl-3">
          {deployment === "testnet" && <TestnetBadge />}
          <ConnectButton />
          <TopBarToggle />
        </div>
      </header>
      <main className="min-h-0 flex-1 p-1.5 lg:p-2">{children}</main>
      {position === "bottom" && (
        <footer className="surface-chrome flex h-10 shrink-0 items-center border-t border-app-hairline px-3 sm:px-4">
          <div className="flex min-w-0 flex-1">{tape}</div>
        </footer>
      )}
      <MobileNav />
    </div>
    </MobileViewProvider>
  );
}
