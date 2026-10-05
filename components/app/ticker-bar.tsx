import { cookies } from "next/headers";
import Image from "next/image";
import { Suspense } from "react";
import { ConnectButton } from "@/components/terminal/connect-button";
import { DEFAULT_TAPE_SYMBOLS, parseTapeCookie, pickMarkets, TAPE_COOKIE } from "@/lib/markets/model";
import { getMarkets } from "@/lib/markets/server";
import { AlphaBadge } from "./alpha-notice";
import { TickerTape } from "./ticker-tape";

async function getInitialTape() {
  const settings = parseTapeCookie((await cookies()).get(TAPE_COOKIE)?.value);
  const symbols = settings.symbols ?? DEFAULT_TAPE_SYMBOLS;
  const markets = symbols.length > 0 ? pickMarkets(await getMarkets(settings.market), symbols) : [];
  return { settings, markets };
}

/** Server-rendered first prices; streamed in so the page shell doesn't wait for the market APIs. */
async function InitialTape() {
  const tape = await getInitialTape();
  return <TickerTape initial={tape.settings} initialMarkets={tape.markets} />;
}

export function TickerBar() {
  return (
    <header className="app-topbar surface-chrome flex h-16 shrink-0 items-center gap-3 border-b border-app-hairline px-3 sm:px-4">
      {/* The sidebar carries the logo on desktop; show it here only when the sidebar is hidden. */}
      <span className="flex shrink-0 md:hidden">
        <Image src="/blacklogo.png" alt="Angler" width={28} height={28} priority className="[html[data-tone=dark]_&]:hidden" />
        <Image src="/whitelogo.png" alt="" aria-hidden width={28} height={28} className="hidden [html[data-tone=dark]_&]:block" />
      </span>
      <AlphaBadge />
      <Suspense fallback={<div aria-hidden className="ticker-tape min-w-0 flex-1" />}>
        <InitialTape />
      </Suspense>

      <div className="flex shrink-0 items-center gap-2 border-l border-app-hairline pl-3">
        <ConnectButton />
      </div>
    </header>
  );
}
