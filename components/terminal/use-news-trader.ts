"use client";

import { useCallback } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import { useToast } from "@/components/app/toast-provider";
import { trackTrade } from "@/lib/analytics/client";
import { MAX_SPOT_PRICE_IMPACT_PCT, sideLabel, type TradeVenueKind } from "@/lib/trading/presets";
import { fromBaseUnits, usdToInputAmount } from "@/lib/venues/jupiter/amounts";
import { spendableBalance } from "@/lib/venues/jupiter/balances";
import { WSOL_MINT } from "@/lib/venues/jupiter/config";
import { MESSAGES } from "@/lib/venues/jupiter/errors";
import { SwapFailedError, jupiterVenue } from "@/lib/venues/jupiter/venue";
import { findMarket } from "@/lib/venues/hyperliquid/markets";
import { sizeForNotional } from "@/lib/venues/hyperliquid/pricing";
import { minimumSize } from "@/lib/venues/lighter/pricing";
import { PERP_VENUE_NAMES, pickPerpMarket } from "@/lib/venues/routing";
import type { OrderSide, PerpVenueId, SpotToken } from "@/lib/venues/types";
import { useSolanaWallet } from "./solana-wallet-provider";
import { useTrading } from "./trading-provider";
import { useWalletModal } from "./wallet-modal";
import { useWallet } from "./wallet-provider";

/** Lamports kept for fees on top of what the quote reports (ATA rent, retries). */
const SOL_FEE_BUFFER = 2_000_000n;

export interface NewsTrade {
  symbol: string;
  mint?: string;
  venue: TradeVenueKind;
  /** Perp venue chosen when the ticket was armed; re-resolved if missing. */
  perpVenue?: PerpVenueId;
  side: OrderSide;
  sizeUsd: number;
  newsId?: string;
  oneClick: boolean;
}

function amountText(amount: bigint, token: SpotToken) {
  return `${fromBaseUnits(amount, token.decimals).toLocaleString("en-US", { maximumSignificantDigits: 6 })} ${token.symbol}`;
}

/**
 * Places news trades without an order form. Perps: market order at the configured leverage on the ticket's perp
 * venue (Hyperliquid or Lighter; the provider opens that venue's setup when needed). Spot: balance checks, a fresh
 * Jupiter quote with a price impact guard, wallet signature, execute. Resolves to whether the trade was placed.
 */
export function useNewsTrader() {
  const toast = useToast();
  const { preferences } = usePreferences();
  const { address: evmAddress } = useWallet();
  const { open: openWallets } = useWalletModal();
  const { marketsByVenue, perpOrder, placeOrder } = useTrading();
  const { address: solanaAddress, signTransaction } = useSolanaWallet();

  const fail = useCallback((message: string) => toast({ tone: "error", title: "Order not placed", message }), [toast]);

  const tradePerp = useCallback(
    async (trade: NewsTrade) => {
      const venueName = trade.perpVenue ? PERP_VENUE_NAMES[trade.perpVenue] : "a perp venue";
      if (!evmAddress) {
        fail(`Connect an EVM wallet to trade on ${venueName}.`);
        openWallets();
        return false;
      }
      const venueMarkets = trade.perpVenue ? marketsByVenue[trade.perpVenue] : undefined;
      const market = venueMarkets ? findMarket(venueMarkets, trade.symbol) : (pickPerpMarket(trade.symbol, marketsByVenue, perpOrder) ?? null);
      if (!market) return fail(`${trade.symbol} isn't listed on ${venueName}.`), false;
      const price = market.midPx ?? market.markPx;
      if (!price) return fail(`No price for ${trade.symbol} right now.`), false;
      const size = sizeForNotional(trade.sizeUsd, price, market.szDecimals);
      if (!(size > 0)) return fail(`$${trade.sizeUsd} is below ${trade.symbol}'s minimum lot.`), false;
      if (market.venue === "lighter" && size < minimumSize(market, price)) {
        return fail(`$${trade.sizeUsd} is below Lighter's ${trade.symbol} minimum (about $${Math.ceil(minimumSize(market, price) * price)}).`), false;
      }
      return placeOrder({
        market,
        side: trade.side,
        kind: "market",
        size,
        leverage: Math.min(preferences.newsLeverage, market.maxLeverage),
      });
    },
    [evmAddress, openWallets, marketsByVenue, perpOrder, placeOrder, preferences.newsLeverage, fail],
  );

  const tradeSpot = useCallback(
    async (trade: NewsTrade) => {
      if (!solanaAddress || !signTransaction) {
        fail("Connect a Solana wallet to trade on Jupiter.");
        openWallets();
        return false;
      }
      try {
        const [usdc, token] = await Promise.all([jupiterVenue.quoteToken(), jupiterVenue.resolveToken({ symbol: trade.symbol, mint: trade.mint })]);
        if (!token) return fail(`${trade.symbol} has no verified token on Jupiter.`), false;
        const inputToken = trade.side === "buy" ? usdc : token;
        const outputToken = trade.side === "buy" ? token : usdc;
        const amount = usdToInputAmount(trade.sizeUsd, trade.side, usdc, token);
        if (amount <= 0n) return fail("Size is too small."), false;

        const balances = await jupiterVenue.getBalances(solanaAddress, [usdc.mint, token.mint]);
        const quote = await jupiterVenue.getQuote({ inputToken, outputToken, amount, taker: solanaAddress });
        const fees = BigInt(quote.networkFeeLamports) + SOL_FEE_BUFFER;
        const spendsSol = inputToken.mint === WSOL_MINT;
        if (amount + (spendsSol ? fees : 0n) > spendableBalance(inputToken.mint, balances.tokens, balances.lamports)) {
          return fail(MESSAGES.insufficientBalance), false;
        }
        if (!spendsSol && balances.lamports < fees) return fail(MESSAGES.insufficientSol), false;
        if (quote.error || !quote.transaction) return fail(quote.error ?? "This swap can't be executed."), false;
        if (Math.abs(quote.priceImpactPct) > MAX_SPOT_PRICE_IMPACT_PCT) {
          return fail(`Price impact is ${quote.priceImpactPct.toFixed(2)}%, above the ${MAX_SPOT_PRICE_IMPACT_PCT}% limit. Try a smaller size.`), false;
        }

        const result = await jupiterVenue.executeQuote(quote, signTransaction);
        const bought = trade.side === "buy";
        toast({
          tone: "success",
          title: `${bought ? "Bought" : "Sold"} ${amountText(bought ? result.outAmount : result.inAmount, token)}`,
          message: `${bought ? "Spent" : "Received"} ${amountText(bought ? result.inAmount : result.outAmount, usdc)} · min. received was ${amountText(quote.minOutAmount, outputToken)}`,
          link: { href: result.explorerUrl, label: "View on Solscan" },
        });
        return true;
      } catch (error) {
        toast({
          tone: "error",
          title: "Swap failed",
          message: error instanceof Error ? error.message : String(error),
          link: error instanceof SwapFailedError && error.explorerUrl ? { href: error.explorerUrl, label: "View on Solscan" } : undefined,
        });
        return false;
      }
    },
    [solanaAddress, signTransaction, fail, toast, openWallets],
  );

  return useCallback(
    async (trade: NewsTrade) => {
      const placed = trade.venue === "perp" ? await tradePerp(trade) : await tradeSpot(trade);
      if (placed) {
        trackTrade({
          venue: trade.venue === "perp" ? (trade.perpVenue ?? "hyperliquid") : "jupiter",
          side: trade.side,
          newsId: trade.newsId ?? null,
          oneClick: trade.oneClick,
        });
      }
      return placed;
    },
    [tradePerp, tradeSpot],
  );
}

export { sideLabel };
