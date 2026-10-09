"use client";

import { useCallback } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import { useToast } from "@/components/app/toast-provider";
import { trackTrade } from "@/lib/analytics/client";
import { filledUsd, type TradeEvent } from "@/lib/analytics/trades";
import { MAX_SPOT_PRICE_IMPACT_PCT, sideLabel, type TradeVenueKind } from "@/lib/trading/presets";
import { fromBaseUnits, usdToInputAmount } from "@/lib/venues/jupiter/amounts";
import { spendableBalance } from "@/lib/venues/jupiter/balances";
import { USDC_MINT, WSOL_MINT } from "@/lib/venues/jupiter/config";
import { MESSAGES } from "@/lib/venues/jupiter/errors";
import { SwapFailedError, jupiterVenue } from "@/lib/venues/jupiter/venue";
import { findMarket } from "@/lib/venues/hyperliquid/markets";
import { quoteVenues } from "./use-best-execution";
import { sizeForNotional } from "@/lib/venues/hyperliquid/pricing";
import { minimumSize } from "@/lib/venues/lighter/pricing";
import { isLighterVenue } from "@/lib/venues/lighter/config";
import { pickBestSpotQuote } from "@/lib/trading/best-quote";
import { executeTitanQuote, getTitanQuote } from "@/lib/venues/titan/venue";
import { resolveArcusToken } from "@/lib/venues/arcus/catalog";
import { arcusConfig } from "@/lib/venues/arcus/config";
import { quoteRobinhood } from "@/lib/venues/robinhood-quotes";
import { ROBINHOOD_SOURCE_NAMES, robinhoodSources, type RobinhoodSource } from "@/lib/venues/robinhood-sources";
import { PERP_VENUE_NAMES, pickPerpMarket } from "@/lib/venues/routing";
import { claimEvmSwapPoints, claimSwapPoints } from "@/lib/profile/client";
import type { OrderSide, PerpVenueId, SpotQuote, SpotToken, SpotVenueId } from "@/lib/venues/types";
import { useSolanaWallet } from "./solana-wallet-provider";
import { useTrading } from "./trading-provider";
import { useWalletModal } from "./wallet-modal";
import { useWallet } from "./wallet-provider";
import { recordSwap } from "./swap-history-store";

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
  /** Solana swaps: "best" (default) compares Jupiter and Titan; "jupiter" or "titan" uses that one only. */
  spotSource?: "best" | "jupiter" | "titan";
  /** Robinhood Chain stock swaps: one source only; unset compares every enabled one (Arcus, Uniswap). */
  robinhoodSource?: RobinhoodSource;
  side: OrderSide;
  sizeUsd: number;
  /** Solana swaps: the token paid with (or received on a sell); USDC when unset. */
  quoteMint?: string;
  /** Swaps: fixed slippage in bps from the swap card; unset lets each venue choose. */
  slippageBps?: number | null;
  /** Perp leverage; defaults to the news leverage setting. */
  leverage?: number;
  newsId?: string;
  oneClick: boolean;
}

/** What a placed trade reports to analytics; `false` when nothing was placed. */
type Placed = Pick<TradeEvent, "venue" | "usd" | "feeBps"> | false;

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
    async (trade: NewsTrade): Promise<Placed> => {
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
      if (isLighterVenue(market.venue) && size < minimumSize(market, price)) {
        return fail(`$${trade.sizeUsd} is below Lighter's ${trade.symbol} minimum (about $${Math.ceil(minimumSize(market, price) * price)}).`), false;
      }
      const placed = await placeOrder({
        market,
        side: trade.side,
        kind: "market",
        size,
        leverage: Math.max(1, Math.min(trade.leverage ?? preferences.newsLeverage, market.maxLeverage)),
      });
      if (!placed) return false;
      return { venue: market.venue, usd: filledUsd(placed), feeBps: placed.status === "filled" ? placed.partnerFeeBps : null } satisfies Placed;
    },
    [evmAddress, openWallets, marketsByVenue, perpOrder, placeOrder, preferences.newsLeverage, preferences.autoRoute, fail],
  );

  const tradeSpot = useCallback(
    async (trade: NewsTrade): Promise<Placed> => {
      if (!solanaAddress || !signTransaction) {
        fail("Connect a Solana wallet to trade on Jupiter.");
        openWallets();
        return false;
      }
      try {
        const [payToken, token] = await Promise.all([jupiterVenue.quoteToken(trade.quoteMint), jupiterVenue.resolveToken({ symbol: trade.symbol, mint: trade.mint })]);
        if (!token) return fail(`${trade.symbol} has no verified token on Jupiter.`), false;
        const inputToken = trade.side === "buy" ? payToken : token;
        const outputToken = trade.side === "buy" ? token : payToken;
        const amount = usdToInputAmount(trade.sizeUsd, trade.side, payToken, token);
        if (amount <= 0n) return fail("Size is too small."), false;

        const input = { inputToken, outputToken, amount, taker: solanaAddress, slippageBps: trade.slippageBps };
        // Jupiter and Titan quote the same swap; the one with more output is executed.
        const [balances, jupiter, titan] = await Promise.all([
          jupiterVenue.getBalances(solanaAddress, [payToken.mint, token.mint], { fresh: true }),
          trade.spotSource === "titan" ? Promise.resolve(null) : jupiterVenue.getQuote(input).catch((error: unknown) => error),
          // Private (MEV-protected) swaps land through Jupiter's Beam only.
          preferences.venueTitan && !preferences.privateSwap && trade.spotSource !== "jupiter" ? getTitanQuote(input) : Promise.resolve(null),
        ]);
        const jupiterQuote = jupiter instanceof Error ? null : (jupiter as SpotQuote);
        const quote = pickBestSpotQuote([jupiterQuote, titan]);
        if (!quote) {
          const reason = trade.spotSource === "titan" ? "Titan found no route for this swap." : jupiter instanceof Error ? jupiter.message : jupiterQuote?.error;
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
          message: `${bought ? "Spent" : "Received"} ${amountText(bought ? result.inAmount : result.outAmount, payToken)} · min. received was ${amountText(quote.minOutAmount, outputToken)} · via ${viaTitan ? "Titan" : "Jupiter"}`,
          link: { href: result.explorerUrl, label: "View on Solscan" },
        });
        // Profile points: the server checks the transaction paid our fee before counting it.
        claimSwapPoints(result.signature);
        // The quote side of the swap is its USD volume (USDC at par, another token at its price).
        const paid = fromBaseUnits(bought ? result.inAmount : result.outAmount, payToken.decimals);
        const usd = payToken.mint === USDC_MINT ? paid : paid * (payToken.usdPrice ?? 0);
        // "Your trades" and the holdings' PnL on /swap.
        recordSwap(solanaAddress, {
          tx: result.signature,
          at: Date.now(),
          chain: "solana",
          token: token.mint,
          symbol: token.symbol,
          side: trade.side,
          amount: fromBaseUnits(bought ? result.outAmount : result.inAmount, token.decimals),
          usd,
        });
        return { venue: viaTitan ? "titan" : "jupiter", usd, feeBps: null } satisfies Placed;
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
    [solanaAddress, signTransaction, fail, toast, openWallets, preferences.venueTitan, preferences.privateSwap],
  );

  const tradeArcus = useCallback(
    async (trade: NewsTrade): Promise<Placed> => {
      if (!evmAddress || !evmWallet) {
        fail("Connect an EVM wallet to trade stock tokens on Robinhood Chain.");
        openWallets();
        return false;
      }
      const enabled = robinhoodSources(preferences);
      const sources = trade.robinhoodSource ? enabled.filter((source) => source === trade.robinhoodSource) : enabled;
      if (sources.length === 0) return fail("No Robinhood Chain swap venue is on. Turn on Arcus or Uniswap in Settings → Venues."), false;
      let source = sources[0];
      try {
        const token = await resolveArcusToken(trade.symbol);
        if (!token) return fail(`${trade.symbol} isn't listed on Robinhood Chain.`), false;
        // With Uniswap in the mix both sources quote the same swap and the larger output wins (Arcus on a tie, or while
        // Uniswap pays under 0.5% more when Arcus is preferred).
        const compared = sources.includes("uniswap")
          ? await quoteRobinhood({ token, side: trade.side, sizeUsd: trade.sizeUsd, sources, taker: evmAddress, slippageBps: trade.slippageBps, preferArcus: preferences.preferArcus })
          : null;
        if (compared) {
          const best = compared.quotes.find((quote) => quote.out !== null);
          if (!best) return fail(compared.quotes[0]?.note ?? "No quote for this swap right now."), false;
          source = best.source;
        }
        let swapped: { txHash: string; explorerUrl: string; sold: { amount: bigint; token: typeof token }; bought: { amount: bigint; token: typeof token }; gasless: boolean };
        if (source === "uniswap" && compared) {
          const { uniswapSwap } = await import("@/lib/venues/uniswap/venue");
          const result = await uniswapSwap({
            provider: evmWallet.provider,
            account: evmAddress,
            chain: arcusConfig.chain,
            tokenIn: compared.sellToken,
            tokenOut: compared.buyToken,
            amount: compared.sellAmount,
            slippageBps: trade.slippageBps,
            maxPriceImpactPct: MAX_SPOT_PRICE_IMPACT_PCT,
          });
          swapped = {
            ...result,
            sold: { amount: result.inAmount, token: compared.sellToken },
            bought: { amount: result.outAmount, token: compared.buyToken },
          };
        } else {
          const { arcusSwap } = await import("@/lib/venues/arcus/venue");
          const result = await arcusSwap({
            provider: evmWallet.provider,
            account: evmAddress,
            token,
            side: trade.side,
            sizeUsd: trade.sizeUsd,
            maxPriceImpactPct: MAX_SPOT_PRICE_IMPACT_PCT,
            slippageBps: trade.slippageBps,
          });
          swapped = { ...result, gasless: true };
        }
        const venueName = ROBINHOOD_SOURCE_NAMES[source];
        const format = (amount: bigint, decimals: number, symbol: string) =>
          `${fromBaseUnits(amount, decimals).toLocaleString("en-US", { maximumSignificantDigits: 6 })} ${symbol}`;
        const bought = trade.side === "buy";
        const { sold: soldLeg, bought: boughtLeg } = swapped;
        toast({
          tone: "success",
          title: `${bought ? "Bought" : "Sold"} ${bought ? format(boughtLeg.amount, token.decimals, token.symbol) : format(soldLeg.amount, token.decimals, token.symbol)}`,
          message: bought
            ? `Spent ${format(soldLeg.amount, soldLeg.token.decimals, soldLeg.token.symbol)} on ${venueName}`
            : `Received ${format(boughtLeg.amount, boughtLeg.token.decimals, boughtLeg.token.symbol)} on ${venueName}`,
          link: { href: swapped.explorerUrl, label: "View transaction" },
        });
        // USDG is the dollar side of a Robinhood Chain swap.
        const usd = bought ? fromBaseUnits(soldLeg.amount, soldLeg.token.decimals) : fromBaseUnits(boughtLeg.amount, boughtLeg.token.decimals);
        recordSwap(evmAddress, {
          tx: swapped.txHash,
          at: Date.now(),
          chain: "robinhood",
          token: token.address,
          symbol: token.symbol,
          side: trade.side,
          amount: fromBaseUnits(bought ? boughtLeg.amount : soldLeg.amount, token.decimals),
          usd,
        });
        claimEvmSwapPoints(arcusConfig.chainId, swapped.txHash, source === "uniswap" ? "uniswap" : "arcus", evmAddress);
        return { venue: source, usd, feeBps: null } satisfies Placed;
      } catch (error) {
        toast({
          tone: "error",
          title: `${ROBINHOOD_SOURCE_NAMES[source]} swap failed`,
          message: error instanceof Error ? error.message : String(error),
          link:
            error instanceof Error && "explorerUrl" in error && typeof error.explorerUrl === "string" && error.explorerUrl
              ? { href: error.explorerUrl, label: "View transaction" }
              : undefined,
        });
        return false;
      }
    },
    [evmAddress, evmWallet, fail, toast, openWallets, preferences],
  );

  return useCallback(
    async (trade: NewsTrade) => {
      const placed =
        trade.venue === "perp" ? await tradePerp(trade) : trade.spotVenue === "arcus" ? await tradeArcus(trade) : await tradeSpot(trade);
      // Perp trades report the venue they actually went to (routing can change it), swaps Jupiter or Titan.
      if (placed) trackTrade({ ...placed, side: trade.side, newsId: trade.newsId ?? null, oneClick: trade.oneClick });
      return Boolean(placed);
    },
    [tradePerp, tradeSpot, tradeArcus],
  );
}

export { sideLabel };
