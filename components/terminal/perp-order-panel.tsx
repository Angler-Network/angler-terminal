"use client";

import { KeyRound, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MarketIcon } from "@/components/app/market-icon";
import { formatPrice } from "@/lib/format";
import { sizeForNotional } from "@/lib/venues/hyperliquid/pricing";
import type { OrderKind, OrderSide } from "@/lib/venues/types";
import { useSelectedAsset } from "./selected-asset";
import { useTrading } from "./trading-provider";
import { useWallet } from "./wallet-provider";

const DEFAULT_LEVERAGE = 5;

const field =
  "h-9 w-full rounded-lg border border-app-hairline-strong bg-app-chip px-3 text-[13px] tabular-nums text-app-ink placeholder:text-app-faint focus:border-app-focus focus:outline-none disabled:opacity-60";

const label = "flex flex-col gap-1 text-[11px] font-medium uppercase tracking-[0.06em] text-app-muted";

function Segmented<T extends string>({
  value,
  options,
  onChange,
  name,
}: {
  value: T;
  options: { value: T; label: string; activeClass?: string }[];
  onChange: (value: T) => void;
  name: string;
}) {
  return (
    <div role="group" aria-label={name} className="grid grid-flow-col gap-1 rounded-lg bg-app-chip p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`h-8 rounded-md text-[13px] font-semibold transition-colors ${
            value === option.value ? (option.activeClass ?? "bg-app-card text-app-ink shadow-sm") : "text-app-muted hover:text-app-ink"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function TradingKeyStatus() {
  const { onboarding, revoke, openSetup } = useTrading();
  const [isRevoking, setIsRevoking] = useState(false);
  if (!onboarding) return null;

  if (onboarding.agentAddress) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-app-hairline px-2.5 py-2 text-[12px]">
        <KeyRound className="size-3.5 text-app-up" aria-hidden />
        <span className="font-medium text-app-ink" title={onboarding.agentAddress}>
          Trading key active
        </span>
        <button
          type="button"
          disabled={isRevoking}
          onClick={async () => {
            setIsRevoking(true);
            await revoke();
            setIsRevoking(false);
          }}
          className="ml-auto font-semibold text-app-down hover:underline disabled:opacity-60"
        >
          {isRevoking ? "Revoking…" : "Revoke"}
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={openSetup}
      className="flex items-center gap-2 rounded-lg border border-dashed border-app-hairline-strong px-2.5 py-2 text-left text-[12px] text-app-muted hover:text-app-ink"
    >
      <KeyRound className="size-3.5" aria-hidden />
      No trading key yet. Set up trading
    </button>
  );
}

export function PerpOrderPanel({ venueTabs }: { venueTabs?: React.ReactNode }) {
  const { symbol } = useSelectedAsset();
  const { address, connect } = useWallet();
  const { market, markets, account, placeOrder, venueName, network } = useTrading();
  const [side, setSide] = useState<OrderSide>("buy");
  const [kind, setKind] = useState<OrderKind>("market");
  const [usd, setUsd] = useState("");
  const [limitPx, setLimitPx] = useState("");
  const [leverage, setLeverage] = useState(DEFAULT_LEVERAGE);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const position = account?.positions.find((entry) => entry.coin === market?.coin);
  const maxLeverage = market?.maxLeverage ?? 1;

  // Start from the position's current leverage when there is one; otherwise the default, capped by the market.
  useEffect(() => {
    setLeverage(Math.min(position?.leverage ?? DEFAULT_LEVERAGE, maxLeverage));
    setLimitPx("");
  }, [market?.coin, maxLeverage, position?.leverage]);

  const referencePx = kind === "limit" && Number(limitPx) > 0 ? Number(limitPx) : (market?.midPx ?? market?.markPx ?? 0);
  const size = useMemo(
    () => (market ? sizeForNotional(Number(usd), referencePx, market.szDecimals) : 0),
    [market, usd, referencePx],
  );

  const disabledReason = !address
    ? null
    : market === undefined
      ? "Loading markets…"
      : market === null
        ? `${symbol} isn't listed on ${venueName}${network === "testnet" ? " testnet" : ""}.`
        : !(Number(usd) > 0)
          ? "Enter a size"
          : kind === "limit" && !(Number(limitPx) > 0)
            ? "Enter a limit price"
            : !(size > 0)
              ? "Size below the minimum lot"
              : null;

  const submit = async () => {
    if (!market || disabledReason) return;
    setIsSubmitting(true);
    const placed = await placeOrder({
      market,
      side,
      kind,
      size,
      limitPx: kind === "limit" ? Number(limitPx) : undefined,
      leverage,
    });
    setIsSubmitting(false);
    if (placed) setUsd("");
  };

  return (
    <section
      aria-label="Order entry"
      className="surface-panel flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-app-card/80 bg-app-card/55"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-app-hairline px-3 py-2">
        <MarketIcon symbol={symbol} kind={market?.kind} size={20} />
        <h2 className="min-w-0 truncate text-[13px] font-semibold text-app-ink">{market?.coin ?? symbol}-PERP</h2>
        <span className="ml-auto rounded bg-app-chip px-1.5 py-[3px] text-[10px] font-semibold uppercase tracking-[0.08em] text-app-muted">
          {venueName}
          {network === "testnet" ? " · Testnet" : ""}
        </span>
      </header>
      {venueTabs}

      <form
        className="scrollbar-subtle flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Segmented
          name="Side"
          value={side}
          onChange={setSide}
          options={[
            { value: "buy", label: "Long", activeClass: "bg-app-up text-white" },
            { value: "sell", label: "Short", activeClass: "bg-app-down text-white" },
          ]}
        />
        <Segmented
          name="Order type"
          value={kind}
          onChange={setKind}
          options={[
            { value: "market", label: "Market" },
            { value: "limit", label: "Limit" },
          ]}
        />
        {kind === "limit" && (
          <label className={label}>
            Limit price
            <input
              inputMode="decimal"
              value={limitPx}
              onChange={(event) => setLimitPx(event.target.value.replace(/[^\d.]/g, ""))}
              placeholder={market?.midPx ? String(market.midPx) : "0.00"}
              className={field}
            />
          </label>
        )}
        <label className={label}>
          Size (USD)
          <input
            inputMode="decimal"
            value={usd}
            onChange={(event) => setUsd(event.target.value.replace(/[^\d.]/g, ""))}
            placeholder="0.00"
            className={field}
          />
          <span className="text-[11px] normal-case tracking-normal text-app-faint">
            ≈ {size > 0 ? size : 0} {market?.symbol ?? symbol}
          </span>
        </label>
        <label className={label}>
          <span className="flex justify-between">
            Leverage <span className="tabular-nums text-app-ink">{leverage}x</span>
          </span>
          <input
            type="range"
            min={1}
            max={Math.max(1, maxLeverage)}
            value={leverage}
            disabled={!market}
            onChange={(event) => setLeverage(Number(event.target.value))}
            className="accent-[rgb(var(--app-accent))]"
          />
        </label>
        <dl className="grid grid-cols-2 gap-y-1 text-[12px]">
          <dt className="text-app-muted">Mark</dt>
          <dd className="text-right tabular-nums text-app-ink">{market?.markPx ? formatPrice(market.markPx) : "—"}</dd>
          <dt className="text-app-muted">Account value</dt>
          <dd className="text-right tabular-nums text-app-ink">{account ? formatPrice(account.accountValue) : "—"}</dd>
          <dt className="text-app-muted">Max leverage</dt>
          <dd className="text-right tabular-nums text-app-ink">{market ? `${market.maxLeverage}x` : "—"}</dd>
        </dl>

        {address ? (
          <button
            type="submit"
            disabled={Boolean(disabledReason) || isSubmitting}
            className={`inline-flex h-10 items-center justify-center gap-2 rounded-xl text-[14px] font-semibold text-white transition-opacity disabled:opacity-50 ${
              side === "buy" ? "bg-app-up" : "bg-app-down"
            }`}
          >
            {isSubmitting && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {disabledReason ?? `${side === "buy" ? "Long" : "Short"} ${market?.symbol ?? symbol}`}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void connect().catch(() => {})}
            className="h-10 rounded-xl bg-app-accent text-[14px] font-semibold text-app-on-accent hover:bg-app-accent/85"
          >
            Connect wallet to trade
          </button>
        )}
        {address && <TradingKeyStatus />}
        {markets?.length === 0 && <p className="text-[12px] text-app-danger">Couldn&apos;t load {venueName} markets.</p>}
      </form>
    </section>
  );
}
