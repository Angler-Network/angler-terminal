import { cookies } from "next/headers";
import { Suspense } from "react";
import { DEFAULT_TAPE_SYMBOLS, parseTapeCookie, pickMarkets, TAPE_COOKIE } from "@/lib/markets/model";
import { getMarkets } from "@/lib/markets/server";
import { TickerTape } from "./ticker-tape";

type TapeCookie = ReturnType<typeof parseTapeCookie>;

/** Server-rendered first prices; streamed in so the page shell doesn't wait for the market APIs. */
async function InitialTape({ settings }: { settings: TapeCookie }) {
  const symbols = settings.symbols ?? DEFAULT_TAPE_SYMBOLS;
  const markets = symbols.length > 0 ? pickMarkets(await getMarkets(settings.market), symbols) : [];
  return <TickerTape initial={settings} initialMarkets={markets} />;
}

/** The price tape, rendered once on the server; `AppFrame` decides whether it sits in the top bar or the footer. */
export async function ServerTape() {
  const settings = parseTapeCookie((await cookies()).get(TAPE_COOKIE)?.value);
  return (
    // Until the server's prices stream in (slow when its cache is cold), the tape fetches its own.
    <Suspense fallback={<TickerTape initial={settings} initialMarkets={[]} />}>
      <InitialTape settings={settings} />
    </Suspense>
  );
}
