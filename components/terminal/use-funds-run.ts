"use client";

import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/app/toast-provider";
import { HL_BRIDGE, HL_WITHDRAW_FEE_USDC, ARBITRUM, usdcUnits, USDC_DECIMALS, withdrawalArrived, type SourceChain } from "@/lib/venues/deposits";
import { lighterIntentAddress, readUsdcBalance, sendUsdc } from "@/lib/venues/deposit-client";
import { isLighterVenue, lighterConfigs } from "@/lib/venues/lighter/config";
import { acrossRecipientMinimum, type FundsStep } from "@/lib/venues/bridge-routes";
import { BRIDGE_PROVIDER_NAMES, noRouteReason, type BridgeLegRef } from "@/lib/venues/bridge-leg";
import { PERP_VENUE_NAMES } from "@/lib/venues/routing";
import type { PerpVenueId } from "@/lib/venues/types";
import { useTrading } from "./trading-provider";
import { useWalletModal } from "./wallet-modal";
import { useWallet } from "./wallet-provider";

const ARRIVAL_POLL_MS = 10_000;
const ARRIVAL_TIMEOUT_MS = 12 * 60_000;
const FILL_POLL_MS = 4_000;
const FILL_TIMEOUT_MS = 15 * 60_000;

/** Something the run waits on before its next step: Hyperliquid's withdrawal landing, or the bridge (Across, Relay or LI.FI) filling. */
export type Wait =
  | { kind: "arrival"; before: bigint; expected: bigint; since: number }
  | { kind: "fill"; leg: BridgeLegRef; origin: SourceChain; to: SourceChain; before: bigint | null; expected: bigint; since: number };

/** A route being carried out: `carry` is what the next step moves (the previous step's output). */
export interface Run {
  steps: FundsStep[];
  index: number;
  phase: "ready" | "busy" | "waiting" | "done";
  carry: bigint;
  wait?: Wait;
  explorerUrl?: string;
}

export const units6 = (units: bigint) => Number(units) / 10 ** USDC_DECIMALS;

export function errorMessage(caught: unknown) {
  const message = caught instanceof Error ? caught.message.split("\n")[0] : String(caught);
  return /reject|denied/i.test(message) ? "You rejected the request in your wallet." : message;
}

/** One line per step, for the checklist and the continue button. */
export function stepLabel(step: FundsStep) {
  if (step.kind === "hlWithdraw") return "Withdraw from Hyperliquid (signature, no gas, 1 USDC fee), lands on Arbitrum in 3-4 min";
  if (step.kind === "orderlyWithdraw") return "Withdraw from Orderly (signature, no gas, 1 USDC fee), lands on Arbitrum in a few minutes";
  if (step.kind === "transfer") return `Deposit ${step.source.symbol} to ${PERP_VENUE_NAMES[step.venue]} from ${step.source.name} (a little ETH for gas)`;
  const change = step.from.symbol === step.to.symbol ? step.to.symbol : `${step.from.symbol} → ${step.to.symbol}`;
  const into = step.recipient === "wallet" ? `your wallet on ${step.to.name}` : PERP_VENUE_NAMES[step.recipient];
  return `Bridge to ${into} with Across, Relay or LI.FI, whichever pays most (${change}, seconds; a little ETH on ${step.from.name} for gas)`;
}

export function continueLabel(step: FundsStep, carry: bigint) {
  const amount = units6(carry).toFixed(2);
  if (step.kind === "transfer") return `Deposit ${amount} ${step.source.symbol} to ${PERP_VENUE_NAMES[step.venue]}`;
  if (step.kind === "across") return `Bridge ${amount} ${step.from.symbol} to ${step.recipient === "wallet" ? step.to.name : PERP_VENUE_NAMES[step.recipient]}`;
  return step.kind === "orderlyWithdraw" ? `Withdraw ${amount} USDC from Orderly` : "Withdraw from Hyperliquid";
}

interface FundsRunOptions {
  /** Brings the window that owns the run back (the continue button on "arrived" toasts). */
  resume: () => void;
  /** A lone Hyperliquid withdrawal ends at the signature: Hyperliquid pays out by itself. */
  onWithdrawOnly?: () => void;
  /** Replaces the "Funds moved" toast when something follows the run (the swap card's swap). */
  onDone?: (carry: bigint, explorerUrl: string | undefined) => void;
  /** A lone Hyperliquid withdrawal waits for the USDC to land too (a swap follows it), then calls `onDone`. */
  waitForWithdrawal?: boolean;
}

/**
 * Runs `fundsRoute` steps in order (`bridge-routes.ts`): a Hyperliquid withdrawal, an Across bridge, a transfer into a
 * venue. Every step is one wallet signature; waits (the withdrawal landing on Arbitrum, the Across relayer filling)
 * poll on their own, keep going with the owning window closed, and toast when the next step is ready, which then
 * waits for a press. `carry` is what the next step moves: the previous step's actual output. Used by the funds window
 * and the swap card.
 */
export function useFundsRun(callbacks: FundsRunOptions) {
  const toast = useToast();
  const { withdrawHyperliquid } = useTrading();
  const { address, wallet } = useWallet();
  const { open: openWallets } = useWalletModal();
  const [run, setRun] = useState<Run | null>(null);
  const options = useRef(callbacks);
  options.current = callbacks;

  /** Moves to the step after `current` with `carry`, or finishes. */
  const advance = (current: Run, carry: bigint, explorerUrl?: string) => {
    const next = current.index + 1;
    if (next >= current.steps.length) {
      setRun({ ...current, phase: "done", carry, wait: undefined, explorerUrl: explorerUrl ?? current.explorerUrl });
      if (options.current.onDone) return options.current.onDone(carry, explorerUrl ?? current.explorerUrl);
      const last = current.steps[current.steps.length - 1];
      const where = last.kind === "transfer" ? PERP_VENUE_NAMES[last.venue] : last.kind === "across" && last.recipient !== "wallet" ? PERP_VENUE_NAMES[last.recipient] : "your wallet";
      toast({ tone: "success", title: "Funds moved", message: `${units6(carry).toFixed(2)} sent to ${where}.`, ...(explorerUrl && { link: { href: explorerUrl, label: "View transaction" } }) });
      return;
    }
    setRun({ ...current, index: next, phase: "ready", carry, wait: undefined, explorerUrl: explorerUrl ?? current.explorerUrl });
  };

  const execute = async (current: Run) => {
    if (!address || !wallet) return openWallets();
    const step = current.steps[current.index];
    setRun({ ...current, phase: "busy" });
    try {
      if (step.kind === "orderlyWithdraw") {
        const { withdrawOrderly } = await import("@/lib/venues/orderly/withdraw");
        await withdrawOrderly(wallet.provider, address, current.carry);
        // Orderly pays out by itself, like Hyperliquid: the run ends at the request.
        setRun(null);
        toast({ tone: "success", title: "Orderly withdrawal requested", message: `${units6(current.carry).toFixed(2)} USDC minus Orderly's 1 USDC fee lands on Arbitrum in a few minutes.` });
        return options.current.onWithdrawOnly?.();
      }
      if (step.kind === "hlWithdraw") {
        const before = await readUsdcBalance(ARBITRUM, address);
        const expected = usdcUnits(String(Math.floor((units6(current.carry) - HL_WITHDRAW_FEE_USDC) * 1e6) / 1e6)) ?? 0n;
        if (!(await withdrawHyperliquid(String(units6(current.carry))))) return setRun(current.index === 0 ? null : { ...current, phase: "ready" });
        // A withdrawal straight to the wallet ends here (Hyperliquid pays out by itself and the provider says so).
        if (current.steps.length === 1 && !options.current.waitForWithdrawal) {
          setRun(null);
          return options.current.onWithdrawOnly?.();
        }
        setRun({ ...current, phase: "waiting", wait: { kind: "arrival", before, expected, since: Date.now() } });
        return;
      }
      if (step.kind === "transfer") {
        if (step.target === "orderly") {
          const { depositToOrderly } = await import("@/lib/venues/deposit-client");
          const result = await depositToOrderly(wallet.provider, address, step.source, current.carry);
          return advance(current, current.carry, result.explorerUrl);
        }
        if (step.target === "aster") {
          const { depositToAster } = await import("@/lib/venues/deposit-client");
          const result = await depositToAster(wallet.provider, address, step.source, current.carry);
          return advance(current, current.carry, result.explorerUrl);
        }
        const target = step.target === "bridge" ? HL_BRIDGE : await lighterIntentAddress(lighterConfigs[isLighterVenue(step.venue) ? step.venue : "lighter"], step.source, address);
        const result = await sendUsdc(wallet.provider, address, step.source, target, current.carry);
        return advance(current, current.carry, result.explorerUrl);
      }
      const recipient = step.recipient === "wallet" ? address : await lighterIntentAddress(lighterConfigs[step.recipient], step.to, address);
      const { quoteBridgeLeg, executeBridgeLeg } = await import("@/lib/venues/bridge-leg");
      // Always fresh quotes right before signing (their transactions carry the amounts and a deadline); the larger
      // output of Across, Relay and LI.FI runs.
      const quotes = await quoteBridgeLeg({ from: step.from, to: step.to, units: current.carry, depositor: address, recipient });
      const summary = quotes.best;
      if (!summary) throw new Error(noRouteReason(quotes));
      if (summary.shortBalance) throw new Error(`Not enough ${step.from.symbol} in your wallet on ${step.from.name}.`);
      const minimum = acrossRecipientMinimum(step.recipient);
      if (summary.minOut < BigInt(minimum) * 10n ** BigInt(USDC_DECIMALS)) throw new Error(`${PERP_VENUE_NAMES[step.recipient as PerpVenueId]} needs at least ${minimum} ${step.to.symbol} after fees.`);
      const before = step.recipient === "wallet" ? await readUsdcBalance(step.to, address).catch(() => null) : null;
      const sent = await executeBridgeLeg(wallet.provider, address, step.from, step.to, current.carry, summary);
      setRun({
        ...current,
        phase: "waiting",
        explorerUrl: sent.explorerUrl,
        wait: { kind: "fill", leg: sent.ref, origin: step.from, to: step.to, before, expected: summary.expectedOut, since: Date.now() },
      });
    } catch (caught) {
      toast({ tone: "error", title: "Transfer not sent", message: errorMessage(caught) });
      setRun(current.index === 0 ? null : { ...current, phase: "ready" });
    }
  };

  // Waits keep polling with the window closed and say when the next step is ready.
  const waiting = run?.phase === "waiting" ? run : null;
  useEffect(() => {
    if (!waiting?.wait || !address) return;
    const current = waiting;
    const wait = waiting.wait;
    const resume = () => options.current.resume();
    const timer = window.setInterval(
      async () => {
        if (wait.kind === "arrival") {
          const now = await readUsdcBalance(ARBITRUM, address).catch(() => null);
          if (now !== null && withdrawalArrived(wait.before, now, wait.expected)) {
            const last = current.index + 1 >= current.steps.length;
            advance(current, wait.expected);
            if (!last) toast({ tone: "info", title: "USDC arrived on Arbitrum", message: "Continue to finish the move.", action: { label: "Continue", onClick: resume }, durationMs: 15_000 });
          } else if (Date.now() - wait.since > ARRIVAL_TIMEOUT_MS) {
            toast({ tone: "error", title: "Withdrawal is taking longer than usual", message: "Check your wallet on Arbitrum, then continue from Funds." });
            setRun(null);
          }
          return;
        }
        const { bridgeLegState } = await import("@/lib/venues/bridge-leg");
        const state = await bridgeLegState(wait.leg, wait.origin.chainId).catch(() => "pending" as const);
        if (state === "filled") {
          let carry = wait.expected;
          if (wait.before !== null) {
            const now = await readUsdcBalance(wait.to, address).catch(() => null);
            // What actually arrived, never more than the quote (other funds landing at the same time stay put).
            if (now !== null && now > wait.before) carry = now - wait.before < wait.expected ? now - wait.before : wait.expected;
          }
          const last = current.index + 1 >= current.steps.length;
          advance(current, carry);
          if (!last) toast({ tone: "info", title: `Arrived on ${wait.to.name}`, message: "Continue to finish the move.", action: { label: "Continue", onClick: resume }, durationMs: 15_000 });
        } else if (state === "failed" || Date.now() - wait.since > FILL_TIMEOUT_MS) {
          toast({
            tone: "error",
            title: state === "failed" ? "Bridge refunded" : "Bridge is taking longer than usual",
            message:
              state === "failed"
                ? `${BRIDGE_PROVIDER_NAMES[wait.leg.provider]} returned the funds to your wallet on ${wait.origin.name}.`
                : `Check the transaction; ${BRIDGE_PROVIDER_NAMES[wait.leg.provider]} refunds on the origin chain if it can't fill.`,
            ...(current.explorerUrl && { link: { href: current.explorerUrl, label: "View transaction" } }),
          });
          setRun(null);
        }
      },
      wait.kind === "arrival" ? ARRIVAL_POLL_MS : FILL_POLL_MS,
    );
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one poller per wait
  }, [waiting?.wait, address]);

  return { run, setRun, execute };
}
