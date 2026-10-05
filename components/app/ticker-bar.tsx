import { cookies } from "next/headers";
import Image from "next/image";
import { Suspense } from "react";
import { ConnectButton } from "@/components/terminal/connect-button";
import { DEFAULT_TAPE_SYMBOLS, parseTapeCookie, pickMarkets, TAPE_COOKIE } from "@/lib/markets/model";
import { getMarkets } from "@/lib/markets/server";
import { AlphaBadge } from "./alpha-notice";
import { TickerTape } from "./ticker-tape";

type TapeCookie = ReturnType<typeof parseTapeCookie>;

/** Server-rendered first prices; streamed in so the page shell doesn't wait for the market APIs. */
async function InitialTape({ settings }: { settings: TapeCookie }) {
  const symbols = settings.symbols ?? DEFAULT_TAPE_SYMBOLS;
  const markets = symbols.length > 0 ? pickMarkets(await getMarkets(settings.market), symbols) : [];
  return <TickerTape initial={settings} initialMarkets={markets} />;
}

export async function TickerBar() {
  const settings = parseTapeCookie((await cookies()).get(TAPE_COOKIE)?.value);
  return (
    <header className="app-topbar surface-chrome flex h-16 shrink-0 items-center gap-3 border-b border-app-hairline px-3 sm:px-4">
      {/* The sidebar carries the logo on desktop; show it here only when the sidebar is hidden. */}
      <span className="flex shrink-0 md:hidden">
        <Image src="/blacklogo.png" alt="Angler" width={28} height={28} priority className="[html[data-tone=dark]_&]:hidden" />
        <Image src="/whitelogo.png" alt="" aria-hidden width={28} height={28} className="hidden [html[data-tone=dark]_&]:block" />
      </span>
      <AlphaBadge />
      {/* Until the server's prices stream in (slow when its cache is cold), the tape fetches its own. */}
      <Suspense fallback={<TickerTape initial={settings} initialMarkets={[]} />}>
        <InitialTape settings={settings} />
      </Suspense>

      <div className="flex shrink-0 items-center gap-2 border-l border-app-hairline pl-3">
        <ConnectButton />
      </div>
    </header>
  );
}
