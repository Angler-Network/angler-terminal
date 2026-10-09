"use client";

import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { useSpotHoldings } from "@/components/portfolio/use-spot-holdings";
import { SpotTable, STABLECOINS } from "@/components/portfolio/spot-table";
import { useSpotChartToken, type SpotChartToken } from "@/components/chart/use-spot-chart-token";
import { formatPrice } from "@/lib/format";
import type { PoolNetwork } from "@/lib/spot/pool-candles";
import { assetSymbolOf, normalizeSpotSymbol } from "@/lib/spot/listings";
import { costBasis, unrealizedPnl } from "@/lib/spot/swap-history";
import { ago, shortAddress, type TokenHolder, type TokenTrade } from "@/lib/spot/token-activity";
import { holdingsValue, type SpotHolding } from "@/lib/venues/jupiter/holdings";
import { EVM_SWAP_CHAINS } from "@/lib/venues/uniswap/chains";
import { useSelectedAsset } from "./selected-asset";
import { useSolanaWallet } from "./solana-wallet-provider";
import { useSwapHistory } from "./swap-history-store";
import { useWallet } from "./wallet-provider";
import { useWalletModal } from "./wallet-modal";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
/** Token amounts: compact when large, four significant digits when small (0.0005218 cbBTC, not "0"). */
const tokens = (amount: number) => (amount >= 1000 ? compact.format(amount) : amount.toLocaleString("en-US", { maximumSignificantDigits: 4 }));
const th = "px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-app-faint whitespace-nowrap";
const td = "px-3 py-1.5 tabular-nums whitespace-nowrap text-app-ink";
const TRADES_REFRESH_MS = 30_000;
const MIN_SIZES = [0, 100, 1000];

type Tab = "swaps" | "holders" | "trades" | "holdings";

const evmExplorer = (url: string, name: string) => ({
  name,
  address: (value: string) => `${url}/address/${value}`,
  tx: (value: string) => `${url}/tx/${value}`,
  holders: (token: string) => `${url}/token/${token}${url.includes("blockscout") ? "?tab=holders" : "#balances"}`,
});

const EXPLORERS: Record<PoolNetwork, { name: string; address: (value: string) => string; tx: (value: string) => string; holders?: (token: string) => string }> = {
  solana: { name: "Solana", address: (value) => `https://solscan.io/account/${value}`, tx: (value) => `https://solscan.io/tx/${value}` },
  robinhood: evmExplorer("https://robinhoodchain.blockscout.com", "Robinhood Chain"),
  ...Object.fromEntries(EVM_SWAP_CHAINS.map((chain) => [chain.pool, evmExplorer(chain.explorer, chain.name)])),
} as Record<PoolNetwork, { name: string; address: (value: string) => string; tx: (value: string) => string; holders?: (token: string) => string }>;

/** Recent swaps of the token's busiest pool, refreshed while the tab is visible. */
function usePoolTrades(token: SpotChartToken | null | undefined, active: boolean) {
  const key = token?.network ? `${token.network}:${token.address}` : null;
  const [state, setState] = useState<{ key: string; trades: TokenTrade[]; failed?: boolean } | null>(null);
  useEffect(() => {
    if (!key || !active) return;
    const [network, address] = key.split(":");
    let live = true;
    // GeckoTerminal from the browser first (the visitor's own allowance), our server when that fails.
    const fromServer = () =>
      fetch(`/api/spot/trades?network=${network}&token=${address}`, { cache: "no-store" }).then((response) =>
        response.ok ? (response.json() as Promise<{ trades?: TokenTrade[] }>) : Promise.reject(new Error(String(response.status))),
      );
    const load = () =>
      import("@/lib/spot/pool-direct")
        .then(({ directPoolTrades }) => directPoolTrades(network as PoolNetwork, address))
        .then((direct) => direct ?? { trades: [] }, fromServer)
        .then((body: { trades?: TokenTrade[] }) => live && setState({ key, trades: body.trades ?? [] }))
        .catch(() => live && setState((current) => (current?.key === key ? { ...current, failed: true } : { key, trades: [], failed: true })));
    void load();
    const timer = window.setInterval(() => document.visibilityState !== "hidden" && void load(), TRADES_REFRESH_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [key, active]);
  return key && state?.key === key ? state : null;
}

/** Holder count, concentration and largest wallets of a Solana token. */
function useHolders(token: SpotChartToken | null | undefined) {
  const mint = token?.network === "solana" ? token.address : null;
  const [state, setState] = useState<{ mint: string; count: number | null; top10Pct: number | null; holders: TokenHolder[] } | null>(null);
  useEffect(() => {
    if (!mint) return;
    let live = true;
    fetch(`/api/spot/holders?token=${mint}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { count: number | null; top10Pct: number | null; holders: TokenHolder[] } | null) => live && body && setState({ mint, ...body }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [mint]);
  return mint && state?.mint === mint ? state : null;
}

function Side({ side }: { side: "buy" | "sell" }) {
  return (
    <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${side === "buy" ? "bg-app-up/15 text-app-up" : "bg-app-down/15 text-app-down"}`}>
      {side === "buy" ? "Buy" : "Sell"}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full min-h-24 flex-col items-center justify-center gap-2 px-3 py-4 text-center text-[12px] text-app-muted">{children}</div>;
}

/**
 * The panel under the chart on /swap, for the traded token: Swaps (its busiest pool's recent trades), Holders (count,
 * top-10 share and the largest wallets; Solana only), Your trades (swaps made here, plus your wallet's trades among the
 * recent ones) and My holdings (the Solana wallet's tokens with PnL against what was bought here). Free sources only
 * (GeckoTerminal, Jupiter, Solana RPC); full on-chain histories would need a paid indexer.
 */
export function SwapHoldings() {
  const [tab, setTab] = useState<Tab>("swaps");
  const [minSize, setMinSize] = useState(0);
  const token = useSpotChartToken();
  const { address: solanaAddress } = useSolanaWallet();
  const { address: evmAddress } = useWallet();
  const { open: openWallets } = useWalletModal();
  const { selectAsset } = useSelectedAsset();
  const spot = useSpotHoldings();
  const history = useSwapHistory([solanaAddress, evmAddress]);
  const trades = usePoolTrades(token, tab === "swaps" || tab === "trades");
  const holders = useHolders(tab === "holders" ? token : null);
  const network = token?.network ?? "solana";
  const explorer = EXPLORERS[network];
  const holdings = spot.data?.holdings ?? [];
  const total = holdingsValue(holdings);

  const pick = (holding: SpotHolding) => {
    if (STABLECOINS.has(holding.symbol.toUpperCase())) return;
    const asset = assetSymbolOf({ symbol: holding.symbol, name: holding.name, category: "crypto" }) ?? normalizeSpotSymbol(holding.symbol);
    selectAsset(asset, holding.mint);
  };

  const wallet = network === "solana" ? solanaAddress : evmAddress;
  const sameWallet = (address: string) => (network === "solana" ? address === wallet : address.toLowerCase() === wallet?.toLowerCase());
  const shownTrades = (trades?.trades ?? []).filter((trade) => trade.usd >= minSize);
  const mine = token
    ? (() => {
        // Swaps made here, once per transaction; the pool's trades from this wallet, once per swap (a transaction can
        // hold several), minus those of a transaction already recorded here.
        const recorded = history
          .filter((record) => record.token === token.address)
          .filter((record, index, list) => list.findIndex((other) => other.tx === record.tx) === index)
          .map((record) => ({ key: `angler:${record.tx}`, tx: record.tx, at: record.at, side: record.side, amount: record.amount, usd: record.usd, here: true }));
        const ownTxs = new Set(recorded.map((trade) => trade.tx));
        const onChain = (trades?.trades ?? [])
          .filter((trade) => wallet && sameWallet(trade.trader) && !ownTxs.has(trade.tx))
          .map((trade, index) => ({ key: trade.id ?? `${trade.tx}:${index}`, tx: trade.tx, at: trade.at, side: trade.side, amount: trade.amount, usd: trade.usd, here: false }));
        return [...recorded, ...onChain].sort((a, b) => b.at - a.at);
      })()
    : [];

  const tabs: Array<{ id: Tab; label: string; count?: string }> = [
    { id: "swaps", label: "Swaps" },
    { id: "holders", label: "Holders", count: holders?.count ? compact.format(holders.count) : undefined },
    { id: "trades", label: "Your trades", count: mine.length ? String(mine.length) : undefined },
    { id: "holdings", label: "My holdings", count: holdings.length ? String(holdings.length) : undefined },
  ];

  const pnlCell = (holding: SpotHolding) => {
    const result = unrealizedPnl(costBasis(history, holding.mint), holding.amount, holding.usdPrice);
    if (!result) return <span className="text-app-faint" title="Bought outside Angler: the cost isn't known here">—</span>;
    const up = result.pnl >= 0;
    return (
      <span
        className={up ? "text-app-up" : "text-app-down"}
        title={`Average cost ${formatPrice(result.average)}${result.partial ? ". Only the part bought here is counted." : ""}`}
      >
        {up ? "+" : "-"}
        {usd.format(Math.abs(result.pnl))} ({up ? "+" : ""}
        {result.pct.toFixed(1)}%){result.partial ? "*" : ""}
      </span>
    );
  };

  return (
    <section aria-label="Token activity" className="surface-panel flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-app-card/80 bg-app-card/55">
      <div role="tablist" className="scrollbar-none flex shrink-0 items-center gap-4 overflow-x-auto whitespace-nowrap border-b border-app-hairline px-3">
        {tabs.map(({ id, label, count }) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`-mb-px h-9 border-b-2 text-[12px] font-semibold transition-colors ${tab === id ? "border-app-accent text-app-ink" : "border-transparent text-app-muted hover:text-app-ink"}`}
          >
            {label}
            {count && <span className="ml-1 tabular-nums text-app-faint">{count}</span>}
          </button>
        ))}
        {tab === "swaps" && (
          <span className="ml-auto flex items-center gap-1 text-[11px]">
            {MIN_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => setMinSize(size)}
                className={`h-6 rounded-md px-2 font-semibold ${minSize === size ? "bg-app-chip text-app-ink" : "text-app-muted hover:text-app-ink"}`}
              >
                {size === 0 ? "All" : `≥ $${compact.format(size)}`}
              </button>
            ))}
          </span>
        )}
        {tab === "holdings" && holdings.length > 0 && (
          <span className="ml-auto text-[12px] text-app-muted">
            Total <span className="font-semibold tabular-nums text-app-ink">{usd.format(total)}</span>
          </span>
        )}
      </div>
      <div className="scrollbar-subtle min-h-0 flex-1 overflow-auto text-[12px]">
        {tab === "swaps" &&
          (!token?.network ? (
            <Empty>{token?.book ? `${token.symbol} trades on ${token.venue}'s spot order book, not an on-chain pool.` : "No on-chain pool data for this token."}</Empty>
          ) : !trades ? (
            <Empty>Loading swaps…</Empty>
          ) : shownTrades.length === 0 ? (
            <Empty>{trades.failed ? "Recent swaps are unavailable right now." : "No swaps in the last 24 hours."}</Empty>
          ) : (
            <table className="w-full">
              <thead className="sticky top-0 bg-app-card">
                <tr>
                  <th className={th}>Trader</th>
                  <th className={th}>Action</th>
                  <th className={`${th} text-right`}>Amount</th>
                  <th className={`${th} text-right`}>{token.symbol}</th>
                  <th className={`${th} text-right`}>Price</th>
                  <th className={`${th} text-right`}>Time</th>
                </tr>
              </thead>
              <tbody>
                {shownTrades.map((trade, index) => (
                  <tr key={trade.id ?? `${trade.tx}:${index}`} className="border-t border-app-hairline">
                    <td className={td}>
                      <a href={explorer.address(trade.trader)} target="_blank" rel="noopener noreferrer" className="font-mono hover:underline">
                        {shortAddress(trade.trader)}
                      </a>
                      {sameWallet(trade.trader) && <span className="ml-1.5 rounded bg-app-accent/15 px-1 text-[10px] font-semibold text-app-accent">You</span>}
                    </td>
                    <td className={td}>
                      <Side side={trade.side} />
                    </td>
                    <td className={`${td} text-right`}>{usd.format(trade.usd)}</td>
                    <td className={`${td} text-right text-app-muted`}>{tokens(trade.amount)}</td>
                    <td className={`${td} text-right text-app-muted`}>{trade.price ? formatPrice(trade.price) : "—"}</td>
                    <td className={`${td} text-right`}>
                      <a href={explorer.tx(trade.tx)} target="_blank" rel="noopener noreferrer" className="text-app-muted hover:text-app-ink">
                        {ago(trade.at)}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}

        {tab === "holders" &&
          (token?.network !== "solana" ? (
            token?.book ? (
              <Empty>{token.symbol} balances are held inside {token.venue}; there is no public holder list.</Empty>
            ) : token ? (
              <Empty>
                Holders of {token.symbol} on {token.network ? EXPLORERS[token.network].name : "this chain"} are on the explorer.
                <a
                  href={token.network ? (EXPLORERS[token.network].holders?.(token.address) ?? "#") : "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-app-ink hover:underline"
                >
                  View holders <ExternalLink className="size-3" aria-hidden />
                </a>
              </Empty>
            ) : (
              <Empty>Pick a token to see its holders.</Empty>
            )
          ) : !holders ? (
            <Empty>Loading holders…</Empty>
          ) : (
            <>
              <div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-app-hairline px-3 py-2 text-app-muted">
                <span>
                  Holders <span className="font-semibold tabular-nums text-app-ink">{holders.count === null ? "—" : holders.count.toLocaleString("en-US")}</span>
                </span>
                <span>
                  Top 10 hold <span className="font-semibold tabular-nums text-app-ink">{holders.top10Pct === null ? "—" : `${holders.top10Pct.toFixed(2)}%`}</span>
                </span>
              </div>
              {holders.holders.length === 0 ? (
                <Empty>The largest wallets are unavailable right now.</Empty>
              ) : (
                <table className="w-full">
                  <thead className="sticky top-0 bg-app-card">
                    <tr>
                      <th className={th}>#</th>
                      <th className={th}>Wallet</th>
                      <th className={`${th} text-right`}>{token.symbol}</th>
                      <th className={`${th} text-right`}>Value</th>
                      <th className={`${th} w-48`}>Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holders.holders.map((holder, index) => (
                      <tr key={holder.owner} className="border-t border-app-hairline">
                        <td className={`${td} text-app-faint`}>{index + 1}</td>
                        <td className={td}>
                          <a href={explorer.address(holder.owner)} target="_blank" rel="noopener noreferrer" className="font-mono hover:underline">
                            {shortAddress(holder.owner)}
                          </a>
                          {holder.owner === solanaAddress && <span className="ml-1.5 rounded bg-app-accent/15 px-1 text-[10px] font-semibold text-app-accent">You</span>}
                        </td>
                        <td className={`${td} text-right`}>{tokens(holder.amount)}</td>
                        <td className={`${td} text-right text-app-muted`}>{token.price ? usd.format(holder.amount * token.price) : "—"}</td>
                        <td className={td}>
                          <span className="flex items-center gap-2">
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-app-chip">
                              <span className="block h-full rounded-full bg-app-accent" style={{ width: `${Math.min(100, holder.pct)}%` }} />
                            </span>
                            <span className="w-12 text-right text-app-muted">{holder.pct.toFixed(2)}%</span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ))}

        {tab === "trades" &&
          (!wallet ? (
            <Empty>
              Connect a wallet to see your trades.
              <button type="button" onClick={openWallets} className="h-7 rounded-lg bg-app-chip px-3 font-semibold text-app-ink hover:bg-app-selected">
                Connect wallet
              </button>
            </Empty>
          ) : mine.length === 0 ? (
            <Empty>No {token?.symbol ?? ""} swaps yet from this wallet in Angler or in the last day&apos;s trades.</Empty>
          ) : (
            <table className="w-full">
              <thead className="sticky top-0 bg-app-card">
                <tr>
                  <th className={th}>Time</th>
                  <th className={th}>Action</th>
                  <th className={`${th} text-right`}>{token?.symbol}</th>
                  <th className={`${th} text-right`}>Amount</th>
                  <th className={`${th} text-right`}>Price</th>
                  <th className={`${th} text-right`}>Tx</th>
                </tr>
              </thead>
              <tbody>
                {mine.map((trade) => (
                  <tr key={trade.key} className="border-t border-app-hairline">
                    <td className={`${td} text-app-muted`}>{new Date(trade.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className={td}>
                      <Side side={trade.side} />
                    </td>
                    <td className={`${td} text-right`}>{tokens(trade.amount)}</td>
                    <td className={`${td} text-right`}>{usd.format(trade.usd)}</td>
                    <td className={`${td} text-right text-app-muted`}>{trade.amount > 0 ? formatPrice(trade.usd / trade.amount) : "—"}</td>
                    <td className={`${td} text-right`}>
                      <a href={explorer.tx(trade.tx)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-app-muted hover:text-app-ink">
                        {trade.here ? "Angler" : "On-chain"} <ExternalLink className="size-3" aria-hidden />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}

        {tab === "holdings" &&
          (!spot.address ? (
            <Empty>
              Connect a Solana wallet to see your tokens.
              <button type="button" onClick={openWallets} className="h-7 rounded-lg bg-app-chip px-3 font-semibold text-app-ink hover:bg-app-selected">
                Connect wallet
              </button>
            </Empty>
          ) : spot.loading && !spot.data ? (
            <Empty>Loading tokens…</Empty>
          ) : spot.failed && !spot.data ? (
            <Empty>Couldn&apos;t load the wallet&apos;s tokens. Retrying…</Empty>
          ) : (
            <SpotTable holdings={holdings} total={total} onSelect={pick} extra={{ label: "PnL", cell: pnlCell }} />
          ))}
      </div>
    </section>
  );
}
