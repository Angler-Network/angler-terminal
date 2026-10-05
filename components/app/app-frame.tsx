"use client";

import Image from "next/image";
import Link from "next/link";
import { ConnectButton } from "@/components/terminal/connect-button";
import { SidebarToggle, TopBarToggle } from "./layout-toggles";
import { usePreferences } from "./preferences-provider";
import { TopNav } from "./top-nav";

/**
 * Top bar, page and optional footer. The server-rendered price tape is placed once, where `tapePosition` puts it:
 * in the top bar, in a footer strip, or nowhere. With `navMode: "top"` the top bar also carries the navigation.
 */
export function AppFrame({ tape, children }: { tape: React.ReactNode; children: React.ReactNode }) {
  const { preferences, isLoaded } = usePreferences();
  // Before preferences load, render the default spot; html[data-tape] keeps it hidden for other choices.
  const position = isLoaded ? preferences.tapePosition : "top";

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="app-topbar surface-chrome flex h-16 shrink-0 items-center gap-3 border-b border-app-hairline px-3 sm:px-4">
        {/* The rail carries the logo; the top bar shows it on small screens and in top navigation. */}
        <Link href="/" aria-label="Angler Terminal" className="flex shrink-0 md:hidden [html[data-nav=top]_&]:flex">
          <Image src="/blacklogo.png" alt="Angler" width={28} height={28} priority className="[html[data-tone=dark]_&]:hidden" />
          <Image src="/whitelogo.png" alt="" aria-hidden width={28} height={28} className="hidden [html[data-tone=dark]_&]:block" />
        </Link>
        <span className="app-sidebar-toggle contents">
          <SidebarToggle />
        </span>
        <TopNav />
        {position === "top" ? <div className="app-tape-top flex min-w-0 flex-1">{tape}</div> : <div className="flex-1" />}
        <div className="flex shrink-0 items-center gap-2 border-l border-app-hairline pl-3">
          <ConnectButton />
          <TopBarToggle />
        </div>
      </header>
      <main className="min-h-0 flex-1 p-2">{children}</main>
      {position === "bottom" && (
        <footer className="surface-chrome flex h-12 shrink-0 items-center border-t border-app-hairline px-3 sm:px-4">
          <div className="flex min-w-0 flex-1">{tape}</div>
        </footer>
      )}
    </div>
  );
}
