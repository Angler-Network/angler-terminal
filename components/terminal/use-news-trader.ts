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
import { quoteVenues } from "./use-best-execution";
import { sizeForNotional } from "@/lib/venues/hyperliquid/pricing";
import { minimumSize } from "@/lib/venues/lighter/pricing";
import { pickBestSpotQuote } from "@/lib/trading/best-quote";
import { executeTitanQuote, getTitanQuote } from "@/lib/venues/titan/venue";
import { resolveArcusToken } from "@/lib/venues/arcus/catalog";
import { PERP_VENUE_NAMES, pickPerpMarket } from "@/lib/venues/routing";
import type { OrderSide, PerpVenueId, SpotQuote, SpotToken, SpotVenueId } from "@/lib/venues/types";
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
  /** Spot venue; Jupiter when unset. */
  spotVenue?: SpotVenueId;
  side: OrderSide;
  sizeUsd: number;
  /** Perp leverage; defaults to the news leverage setting. */
  leverage?: number;
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
  const { address: evmAddress, wallet: evmWallet } = useWallet();
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
      let market = venueMarkets ? findMarket(venueMarkets, trade.symbol) : (pickPerpMarket(trade.symbol, marketsByVenue, perpOrder) ?? null);
      if (!market) return fail(`${trade.symbol} isn't listed on ${venueName}.`), false;
      // News trades follow the best price too: quote every venue that lists the asset and take the cheapest.
      if (trade.newsId && preferences.autoRoute) {
        const candidates = perpOrder.flatMap((venue) => {
          const list = marketsByVenue[venue];
          const found = list ? findMarket(list, trade.symbol) : null;
          return found ? [found] : [];
        });
        if (candidates.length > 1) {
          const best = (await quoteVenues(candidates, trade.side, trade.sizeUsd).catch(() => []))[0];
          market = candidates.find((candidate) => candidate.venue === best?.venue) ?? market;
        }
      }
      const price = market.midPx ?? market.markPx;
      if (!price) return fail(`No price for ${trade.symbol} right now.`), false;
      const size = sizeForNotional(trade.sizeUsd, price, market.szDecimals);
      if (!(size > 0)) return fail(`$${trade.sizeUsd} is below ${trade.symbol}'s minimum lot.`), false;
      if (market.venue === "lighter" && size < minimumSize(market, price)) {
        return fail(`$${trade.sizeUsd} is below Lighter's ${trade.symbol} minimum (about $${Math.ceil(minimumSize(market, price) * price)}).`), false;
      }
      const placed = await placeOrder({
        market,
        side: trade.side,
        kind: "market",
        size,
        leverage: Math.max(1, Math.min(trade.leverage ?? preferences.newsLeverage, market.maxLeverage)),
      });
      return placed ? market.venue : false;
    },
    [evmAddress, openWallets, marketsByVenue, perpOrder, placeOrder, preferences.newsLeverage, preferences.autoRoute, fail],
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

        const input = { inputToken, outputToken, amount, taker: solanaAddress };
        // Jupiter and Titan quote the same swap; the one with more output is executed.
        const [balances, jupiter, titan] = await Promise.all([
          jupiterVenue.getBalances(solanaAddress, [usdc.mint, token.mint]),
          jupiterVenue.getQuote(input).catch((error: unknown) => error),
          preferences.venueTitan ? getTitanQuote(input) : Promise.resolve(null),
        ]);
        const jupiterQuote = jupiter instanceof Error ? null : (jupiter as SpotQuote);
        const quote = pickBestSpotQuote([jupiterQuote, titan]);
        if (!quote) {
          const reason = jupiter instanceof Error ? jupiter.message : jupiterQuote?.error;
          return fail(reason ?? "This swap can't be executed."), false;
        }
        const viaTitan = quote === titan;
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

        const result = viaTitan ? await executeTitanQuote(quote, signTransaction) : await jupiterVenue.executeQuote(quote, signTransaction);
        const bought = trade.side === "buy";
        toast({
          tone: "success",
          title: `${bought ? "Bought" : "Sold"} ${amountText(bought ? result.outAmount : result.inAmount, token)}`,
          message: `${bought ? "Spent" : "Received"} ${amountText(bought ? result.inAmount : result.outAmount, usdc)} · min. received was ${amountText(quote.minOutAmount, outputToken)} · via ${viaTitan ? "Titan" : "Jupiter"}`,
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
    [solanaAddress, signTransaction, fail, toast, openWallets, preferences.venueTitan],
  );

  const tradeArcus = useCallback(
    async (trade: NewsTrade) => {
      if (!evmAddress || !evmWallet) {
        fail("Connect an EVM wallet to trade stock tokens on Arcus.");
        openWallets();
        return false;
      }
      try {
        const token = await resolveArcusToken(trade.symbol);
        if (!token) return fail(`${trade.symbol} isn't listed on Arcus.`), false;
        const { arcusSwap } = await import("@/lib/venues/arcus/venue");
        const result = await arcusSwap({
          provider: evmWallet.provider,
          account: evmAddress,
          token,
          side: trade.side,
          sizeUsd: trade.sizeUsd,
          maxPriceImpactPct: MAX_SPOT_PRICE_IMPACT_PCT,
        });
        const format = (amount: bigint, decimals: number, symbol: string) =>
          `${fromBaseUnits(amount, decimals).toLocaleString("en-US", { maximumSignificantDigits: 6 })} ${symbol}`;
        const bought = trade.side === "buy";
        toast({
          tone: "success",
          title: `${bought ? "Bought" : "Sold"} ${bought ? format(result.bought.amount, token.decimals, token.symbol) : format(result.sold.amount, token.decimals, token.symbol)}`,
          message: bought
            ? `Spent ${format(result.sold.amount, result.sold.token.decimals, result.sold.token.symbol)} on Arcus`
            : `Received ${format(result.bought.amount, result.bought.token.decimals, result.bought.token.symbol)} on Arcus`,
          link: { href: result.explorerUrl, label: "View transaction" },
        });
        return true;
      } catch (error) {
        toast({
          tone: "error",
          title: "Arcus swap failed",
          message: error instanceof Error ? error.message : String(error),
          link:
            error instanceof Error && "explorerUrl" in error && typeof error.explorerUrl === "string"
              ? { href: error.explorerUrl, label: "View transaction" }
              : undefined,
        });
        return false;
      }
    },
    [evmAddress, evmWallet, fail, toast, openWallets],
  );

  return useCallback(
    async (trade: NewsTrade) => {
      const placed =
        trade.venue === "perp" ? await tradePerp(trade) : trade.spotVenue === "arcus" ? await tradeArcus(trade) : await tradeSpot(trade);
      if (placed) {
        trackTrade({
          // A perp trade reports the venue it actually went to (routing can change it).
          venue: trade.venue === "perp" ? (typeof placed === "string" ? placed : (trade.perpVenue ?? "hyperliquid")) : (trade.spotVenue ?? "jupiter"),
          side: trade.side,
          newsId: trade.newsId ?? null,
          oneClick: trade.oneClick,
        });
      }
      return Boolean(placed);
    },
    [tradePerp, tradeSpot, tradeArcus],
  );
}

export { sideLabel };
