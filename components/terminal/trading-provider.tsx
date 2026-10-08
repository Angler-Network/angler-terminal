"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePreferences } from "@/components/app/preferences-provider";
import { useToast } from "@/components/app/toast-provider";
import { hlConfig } from "@/lib/venues/hyperliquid/config";
import {
  approveAgent,
  approveBuilderFee,
  getOnboardingStatus,
  revokeAgent,
  withdrawUsdc,
  type OnboardingStatus,
} from "@/lib/venues/hyperliquid/onboarding";
import { hyperliquidVenue } from "@/lib/venues/hyperliquid/venue";
import { toVenueError } from "@/lib/venues/hyperliquid/errors";
import { isLighterVenue, lighterConfig, lighterConfigs, type LighterConfig, type LighterVenueId } from "@/lib/venues/lighter/config";
import { toLighterVenueError } from "@/lib/venues/lighter/errors";
import {
  approveLighterIntegrator,
  getLighterOnboarding,
  applyLighterReferral,
  registerLighterKey,
  revokeLighterKey,
  type LighterOnboarding,
} from "@/lib/venues/lighter/onboarding";
import { lighterRhVenue, lighterVenue } from "@/lib/venues/lighter/venue";
import { approveAsterAgent, approveAsterBuilder, asterOnboarding, forgetAsterAgent, type AsterOnboarding } from "@/lib/venues/aster/onboarding";
import { asterVenue } from "@/lib/venues/aster/venue";
import { addOrderlyKey, forgetOrderlyKey, orderlyOnboarding, registerOrderly, type OrderlyOnboarding } from "@/lib/venues/orderly/onboarding";
import { orderlyVenue } from "@/lib/venues/orderly/venue";
import { PERP_VENUE_NAMES, perpVenueOrder, type MarketsByVenue } from "@/lib/venues/routing";
import type {
  AccountSnapshot,
  OrderResult,
  PositionTpsl,
  PerpVenue,
  PerpVenueId,
  PlaceOrderInput,
  VenueMarket,
  VenueOpenOrder,
  VenuePosition,
} from "@/lib/venues/types";
import { formatPrice } from "@/lib/format";
import { trackPerpOrder } from "@/lib/analytics/client";
import { useSelectedAsset } from "./selected-asset";
import { useWallet } from "./wallet-provider";

const venues: Record<PerpVenueId, PerpVenue> = { hyperliquid: hyperliquidVenue, lighter: lighterVenue, lighterRh: lighterRhVenue, aster: asterVenue, orderly: orderlyVenue };

interface TradingContextValue {
  /** Hyperliquid network (the chart and the EVM wallet group follow it). */
  network: "mainnet" | "testnet";
  lighterNetwork: "mainnet" | "testnet";
  /** Hyperliquid markets, for the chart. */
  markets: VenueMarket[] | null;
  /** The Hyperliquid market for the selected asset, null if not listed, undefined while loading. */
  market: VenueMarket | null | undefined;
  /** Markets of every enabled perp venue, for routing news trades. */
  marketsByVenue: MarketsByVenue;
  /** Enabled perp venues, preferred first. */
  perpOrder: PerpVenueId[];
  onboarding: OnboardingStatus | null;
  /** Core Lighter's setup state (`lighterStates.lighter`). */
  lighter: LighterOnboarding | null;
  /** Setup state per Lighter exchange: core Lighter and Lighter on Robinhood Chain. */
  lighterStates: Record<LighterVenueId, LighterOnboarding | null>;
  isReady: boolean;
  isVenueReady: (venue: PerpVenueId) => boolean;
  /** Positions and orders of every perp venue, merged. */
  account: AccountSnapshot | null;
  accounts: Partial<Record<PerpVenueId, AccountSnapshot | null>>;
  setupVenue: PerpVenueId | null;
  isSetupOpen: boolean;
  openSetup: (venue?: PerpVenueId) => void;
  closeSetup: () => void;
  approveBuilder: () => Promise<boolean>;
  createAgent: () => Promise<boolean>;
  revoke: () => Promise<void>;
  /** Re-reads a Lighter exchange's setup state (core by default); resolves to it, or null when it couldn't be read. */
  refreshLighter: (venue?: LighterVenueId) => Promise<LighterOnboarding | null>;
  registerLighter: (venue?: LighterVenueId) => Promise<boolean>;
  /** Approves the integrator; with `referral`, also sets our referral code there (the user opted in). */
  approveLighter: (options?: { referral?: boolean; venue?: LighterVenueId }) => Promise<boolean>;
  revokeLighter: (venue?: LighterVenueId) => Promise<void>;
  /** Aster setup: our builder fee and the browser trading key, both approved by the wallet. */
  aster: AsterOnboarding | null;
  approveAster: (step: "builder" | "agent") => Promise<boolean>;
  revokeAster: () => void;
  /** Orderly setup: the account registered under our broker, then a browser trading key, both signed by the wallet. */
  orderly: OrderlyOnboarding | null;
  approveOrderly: (step: "register" | "key") => Promise<boolean>;
  revokeOrderly: () => void;
  /** The fill (or resting order), or null when nothing was placed; callers report it to analytics. */
  placeOrder: (input: PlaceOrderInput) => Promise<OrderResult | null>;
  cancelOrder: (order: VenueOpenOrder) => Promise<void>;
  closePosition: (position: VenuePosition) => Promise<void>;
  setPositionTpsl: (position: VenuePosition, levels: PositionTpsl) => Promise<boolean>;
  /** Venue the deposit window is open for, or null. */
  depositVenue: PerpVenueId | null;
  /** Tab the funds window opens on. */
  depositMode: FundsMode;
  openDeposit: (venue: PerpVenueId, mode?: FundsMode) => void;
  closeDeposit: () => void;
  /** Pro order window (multi and hedge orders across venues). */
  isProOrderOpen: boolean;
  openProOrder: () => void;
  closeProOrder: () => void;
  withdrawHyperliquid: (amount: string) => Promise<boolean>;
}

/** Funds window tabs: deposit from the wallet, withdraw to it (Hyperliquid), or move Hyperliquid → Lighter. */
export type FundsMode = "deposit" | "withdraw" | "move";

const TradingContext = createContext<TradingContextValue | null>(null);

export function useTrading() {
  const context = useContext(TradingContext);
  if (!context) throw new Error("useTrading must be used within TradingProvider");
  return context;
}

function venueError(venue: PerpVenueId, error: unknown) {
  if (venue === "aster" || venue === "orderly") return error instanceof Error ? error : new Error(String(error));
  return isLighterVenue(venue) ? toLighterVenueError(error) : toVenueError(error);
}

function useVenueMarkets(venue: PerpVenue, enabled: boolean) {
  const [markets, setMarkets] = useState<VenueMarket[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let isActive = true;
    venue
      .listMarkets()
      .then((list) => isActive && setMarkets(list))
      .catch(() => isActive && setMarkets([]));
    return () => {
      isActive = false;
    };
  }, [venue, enabled]);
  return markets;
}

type Toast = ReturnType<typeof useToast>;

/**
 * One Lighter exchange for the connected wallet: its markets, setup state (account, browser key, integrator), live
 * account stream and setup actions. Core Lighter and Lighter on Robinhood Chain each get one; they share nothing.
 */
function useLighterInstance(
  config: LighterConfig,
  venue: PerpVenue,
  enabled: boolean,
  address: `0x${string}` | null,
  signMessage: (message: string) => Promise<string>,
  canSign: boolean,
  toast: Toast,
) {
  const markets = useVenueMarkets(venue, enabled);
  const [state, setState] = useState<LighterOnboarding | null>(null);
  const [account, setAccount] = useState<AccountSnapshot | null>(null);
  const fail = useCallback((title: string, error: unknown) => toast({ tone: "error", title, message: toLighterVenueError(error).message }), [toast]);

  const refresh = useCallback(async () => {
    if (!address || !enabled) {
      setState(null);
      return null;
    }
    try {
      const next = await getLighterOnboarding(config, address);
      setState(next);
      return next;
    } catch (error) {
      console.warn(`[${config.venue}] setup state: ${toLighterVenueError(error).message}`);
      setState({ accountIndex: null, keyReady: false, integrator: config.integrator ? "needed" : "none" });
      return null;
    }
  }, [address, enabled, config]);

  useEffect(() => {
    setState(null);
    void refresh();
  }, [refresh]);

  // Resubscribes once a key is registered: open orders need an auth token signed by it.
  const keyReady = Boolean(state?.keyReady);
  useEffect(() => {
    setAccount(null);
    if (!address || !enabled) return;
    return venue.subscribeAccount(address, {
      onSnapshot: setAccount,
      onError: (error) => console.warn(`[${config.venue}] account stream: ${toLighterVenueError(error).message}`),
    });
  }, [address, enabled, keyReady, venue, config]);

  const register = useCallback(async () => {
    if (!address || !canSign) return false;
    try {
      await registerLighterKey(config, signMessage, address);
      await refresh();
      toast({ tone: "success", title: `${config.name} trading key active`, message: `${config.name} orders now sign in the browser without a wallet popup.` });
      return true;
    } catch (error) {
      fail(`Couldn't register the ${config.name} key`, error);
      return false;
    }
  }, [address, canSign, config, signMessage, refresh, fail, toast]);

  const approve = useCallback(
    async (options?: { referral?: boolean }) => {
      if (!address || !canSign) return false;
      try {
        await approveLighterIntegrator(config, signMessage, address);
      } catch (error) {
        fail(`${config.name} approval failed`, error);
        return false;
      }
      // The referral is a bonus: a failure here never blocks trading.
      if (options?.referral) {
        await applyLighterReferral(config, address).catch((error: unknown) =>
          toast({ tone: "info", title: "Referral code not applied", message: toLighterVenueError(error).message }),
        );
      }
      await refresh();
      return true;
    },
    [address, canSign, config, signMessage, refresh, fail, toast],
  );

  const revoke = useCallback(async () => {
    if (!address || !canSign) return;
    try {
      await revokeLighterKey(config, signMessage, address);
      await refresh();
      toast({ tone: "info", title: `${config.name} trading key revoked` });
    } catch (error) {
      fail(`Couldn't revoke the ${config.name} key`, error);
    }
  }, [address, canSign, config, signMessage, refresh, fail, toast]);

  const ready = Boolean(state && state.accountIndex !== null && state.keyReady && state.integrator !== "needed");
  return { markets, state, account, refresh, register, approve, revoke, ready };
}

/**
 * Aster for the connected wallet: markets, setup state (kept in this browser, like the Hyperliquid agent), the polled
 * account once a trading key exists, and the two wallet-signed setup steps.
 */
function useAsterInstance(enabled: boolean, address: `0x${string}` | null, getWalletClient: (() => Promise<import("viem").WalletClient>) | null | undefined, toast: Toast) {
  const markets = useVenueMarkets(asterVenue, enabled);
  const [state, setState] = useState<AsterOnboarding | null>(null);
  const [account, setAccount] = useState<AccountSnapshot | null>(null);
  const refresh = useCallback(() => setState(address && enabled ? asterOnboarding(address) : null), [address, enabled]);
  useEffect(refresh, [refresh]);

  const agentReady = Boolean(state?.agentReady);
  useEffect(() => {
    setAccount(null);
    if (!address || !enabled) return;
    return asterVenue.subscribeAccount(address, {
      onSnapshot: setAccount,
      onError: (error) => console.warn(`[aster] account: ${error instanceof Error ? error.message : String(error)}`),
    });
  }, [address, enabled, agentReady]);

  const approve = useCallback(
    async (step: "builder" | "agent") => {
      if (!address || !getWalletClient) return false;
      try {
        const wallet = await getWalletClient();
        if (step === "builder") await approveAsterBuilder(wallet, address);
        else await approveAsterAgent(wallet, address);
        refresh();
        if (step === "agent") toast({ tone: "success", title: "Aster trading key active", message: "Aster orders now sign in the browser without a wallet popup." });
        return true;
      } catch (error) {
        toast({ tone: "error", title: step === "builder" ? "Aster fee approval failed" : "Couldn't create the Aster key", message: error instanceof Error ? error.message : String(error) });
        return false;
      }
    },
    [address, getWalletClient, refresh, toast],
  );

  const revoke = useCallback(() => {
    if (!address) return;
    forgetAsterAgent(address);
    refresh();
    toast({ tone: "info", title: "Aster trading key removed from this browser" });
  }, [address, refresh, toast]);

  const ready = Boolean(state?.agentReady && state.builder !== "needed");
  return { markets, state, account, approve, revoke, ready };
}

/**
 * Orderly for the connected wallet: markets, setup state (registration is Orderly's; the trading key lives in this
 * browser, encrypted), the polled account once a key exists, and the two wallet-signed setup steps.
 */
function useOrderlyInstance(enabled: boolean, address: `0x${string}` | null, getWalletClient: (() => Promise<import("viem").WalletClient>) | null | undefined, toast: Toast) {
  const markets = useVenueMarkets(orderlyVenue, enabled);
  const [state, setState] = useState<OrderlyOnboarding | null>(null);
  const [account, setAccount] = useState<AccountSnapshot | null>(null);
  const refresh = useCallback(async () => {
    if (!address || !enabled) return setState(null);
    setState(await orderlyOnboarding(address).catch(() => ({ registered: null, keyReady: false, accountId: null })));
  }, [address, enabled]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const keyReady = Boolean(state?.keyReady);
  useEffect(() => {
    setAccount(null);
    if (!address || !enabled) return;
    return orderlyVenue.subscribeAccount(address, {
      onSnapshot: setAccount,
      onError: (error) => console.warn(`[orderly] account: ${error instanceof Error ? error.message : String(error)}`),
    });
  }, [address, enabled, keyReady]);

  const approve = useCallback(
    async (step: "register" | "key") => {
      if (!address || !getWalletClient) return false;
      try {
        const wallet = await getWalletClient();
        if (step === "register") await registerOrderly(wallet, address);
        else await addOrderlyKey(wallet, address);
        await refresh();
        if (step === "key") toast({ tone: "success", title: "Orderly trading key active", message: "Orderly orders now sign in the browser without a wallet popup." });
        return true;
      } catch (error) {
        toast({ tone: "error", title: step === "register" ? "Orderly registration failed" : "Couldn't create the Orderly key", message: error instanceof Error ? error.message : String(error) });
        return false;
      }
    },
    [address, getWalletClient, refresh, toast],
  );

  const revoke = useCallback(() => {
    if (!address) return;
    forgetOrderlyKey(address);
    void refresh();
    toast({ tone: "info", title: "Orderly trading key removed from this browser" });
  }, [address, refresh, toast]);

  const ready = Boolean(state?.registered && state.keyReady);
  return { markets, state, account, approve, revoke, ready };
}

export function TradingProvider({ children }: { children: React.ReactNode }) {
  const toast = useToast();
  const { preferences } = usePreferences();
  const { address, getWalletClient } = useWallet();
  const { symbol } = useSelectedAsset();
  const lighterEnabled = preferences.venueLighter;
  const lighterRhEnabled = preferences.venueLighterRh;
  const asterEnabled = preferences.venueAster;
  const orderlyEnabled = preferences.venueOrderly;
  // Hyperliquid markets also feed the chart, so they load even when Hyperliquid trading is off.
  const markets = useVenueMarkets(hyperliquidVenue, true);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [hlAccount, setHlAccount] = useState<AccountSnapshot | null>(null);
  const [setupVenue, setSetupVenue] = useState<PerpVenueId | null>(null);
  const [depositVenue, setDepositVenue] = useState<PerpVenueId | null>(null);
  const [depositMode, setDepositMode] = useState<FundsMode>("deposit");
  const openDeposit = useCallback((venue: PerpVenueId, mode: FundsMode = "deposit") => {
    setDepositVenue(venue);
    setDepositMode(mode);
  }, []);
  const closeDeposit = useCallback(() => setDepositVenue(null), []);
  const [isProOrderOpen, setProOrderOpen] = useState(false);
  const openProOrder = useCallback(() => setProOrderOpen(true), []);
  const closeProOrder = useCallback(() => setProOrderOpen(false), []);

  const fail = useCallback(
    (venue: PerpVenueId, title: string, error: unknown) => toast({ tone: "error", title, message: venueError(venue, error).message }),
    [toast],
  );

  const market = useMemo(() => {
    if (!markets) return undefined;
    const upper = symbol.toUpperCase();
    return (
      markets.find((entry) => entry.symbol === upper && entry.dex === "") ?? markets.find((entry) => entry.symbol === upper) ?? null
    );
  }, [markets, symbol]);

  const signMessage = useCallback(
    async (message: string) => {
      if (!getWalletClient) throw new Error("Connect an EVM wallet first.");
      return (await getWalletClient()).signMessage({ message });
    },
    [getWalletClient],
  );
  const lighterCore = useLighterInstance(lighterConfig, lighterVenue, lighterEnabled, address, signMessage, Boolean(getWalletClient), toast);
  const lighterRh = useLighterInstance(lighterConfigs.lighterRh, lighterRhVenue, lighterRhEnabled, address, signMessage, Boolean(getWalletClient), toast);
  const lighterByVenue = useMemo(() => ({ lighter: lighterCore, lighterRh }), [lighterCore, lighterRh]);
  const aster = useAsterInstance(asterEnabled, address, getWalletClient, toast);
  const orderly = useOrderlyInstance(orderlyEnabled, address, getWalletClient, toast);
  const lighter = lighterCore.state;
  const lighterStates = useMemo(() => ({ lighter: lighterCore.state, lighterRh: lighterRh.state }), [lighterCore.state, lighterRh.state]);

  const marketsByVenue = useMemo<MarketsByVenue>(
    () => ({
      hyperliquid: preferences.venueHyperliquid ? (markets ?? undefined) : [],
      lighter: lighterEnabled ? (lighterCore.markets ?? undefined) : [],
      lighterRh: lighterRhEnabled ? (lighterRh.markets ?? undefined) : [],
      aster: asterEnabled ? (aster.markets ?? undefined) : [],
      orderly: orderlyEnabled ? (orderly.markets ?? undefined) : [],
    }),
    [preferences.venueHyperliquid, markets, lighterEnabled, lighterCore.markets, lighterRhEnabled, lighterRh.markets, asterEnabled, aster.markets, orderlyEnabled, orderly.markets],
  );

  const perpOrder = useMemo(
    () =>
      perpVenueOrder(preferences.preferredPerpVenue, {
        hyperliquid: preferences.venueHyperliquid,
        lighter: lighterEnabled,
        lighterRh: lighterRhEnabled,
        aster: asterEnabled,
        orderly: orderlyEnabled,
      }),
    [preferences.preferredPerpVenue, preferences.venueHyperliquid, lighterEnabled, lighterRhEnabled, asterEnabled, orderlyEnabled],
  );

  const refreshOnboarding = useCallback(async () => {
    if (!address) return setOnboarding(null);
    try {
      setOnboarding(await getOnboardingStatus(address));
    } catch {
      setOnboarding({ builderApproved: false, agentAddress: null });
    }
  }, [address]);

  useEffect(() => {
    setOnboarding(null);
    void refreshOnboarding();
  }, [refreshOnboarding]);

  useEffect(() => {
    setHlAccount(null);
    if (!address) return;
    return hyperliquidVenue.subscribeAccount(address, {
      onSnapshot: setHlAccount,
      onError: (error) => fail("hyperliquid", "Live account updates failed", error),
    });
  }, [address, fail]);

  const isReady = Boolean(onboarding?.builderApproved && onboarding.agentAddress);
  const isVenueReady = useCallback(
    (venue: PerpVenueId) => (venue === "hyperliquid" ? isReady : venue === "aster" ? aster.ready : venue === "orderly" ? orderly.ready : lighterByVenue[venue].ready),
    [isReady, lighterByVenue, aster.ready, orderly.ready],
  );

  const approveBuilder = useCallback(async () => {
    if (!address || !getWalletClient) return false;
    try {
      await approveBuilderFee(await getWalletClient(), address);
      setOnboarding((current) => ({ agentAddress: current?.agentAddress ?? null, builderApproved: true }));
      return true;
    } catch (error) {
      fail("hyperliquid", "Builder fee approval failed", error);
      return false;
    }
  }, [address, getWalletClient, fail]);

  const createAgent = useCallback(async () => {
    if (!address || !getWalletClient) return false;
    try {
      const agentAddress = await approveAgent(await getWalletClient(), address);
      setOnboarding((current) => ({ builderApproved: current?.builderApproved ?? false, agentAddress }));
      toast({ tone: "success", title: "Trading key active", message: "Orders now sign in the browser without a wallet popup." });
      return true;
    } catch (error) {
      fail("hyperliquid", "Couldn't create the trading key", error);
      return false;
    }
  }, [address, getWalletClient, fail, toast]);

  const revoke = useCallback(async () => {
    if (!address || !getWalletClient) return;
    try {
      await revokeAgent(await getWalletClient(), address);
      setOnboarding((current) => ({ builderApproved: current?.builderApproved ?? false, agentAddress: null }));
      toast({ tone: "info", title: "Trading key revoked" });
    } catch (error) {
      fail("hyperliquid", "Couldn't revoke the trading key", error);
    }
  }, [address, getWalletClient, fail, toast]);

  const refreshLighter = useCallback((venue: LighterVenueId = "lighter") => lighterByVenue[venue].refresh(), [lighterByVenue]);
  const registerLighter = useCallback((venue: LighterVenueId = "lighter") => lighterByVenue[venue].register(), [lighterByVenue]);
  const approveLighter = useCallback(
    (options?: { referral?: boolean; venue?: LighterVenueId }) => lighterByVenue[options?.venue ?? "lighter"].approve(options),
    [lighterByVenue],
  );
  const revokeLighter = useCallback((venue: LighterVenueId = "lighter") => lighterByVenue[venue].revoke(), [lighterByVenue]);

  const placeOrder = useCallback(
    async (input: PlaceOrderInput) => {
      if (!address) return null;
      const venue = input.market.venue;
      if (!isVenueReady(venue)) {
        setSetupVenue(venue);
        return null;
      }
      try {
        const result = await venues[venue].placeOrder(address, input);
        const verb = input.side === "buy" ? "Bought" : "Sold";
        toast(
          result.status === "filled"
            ? {
                tone: "success",
                title: `${verb} ${result.filledSize} ${input.market.symbol}`,
                message: `Average price ${formatPrice(result.avgPx)} on ${PERP_VENUE_NAMES[venue]}`,
              }
            : { tone: "success", title: "Order placed", message: `${input.side === "buy" ? "Buy" : "Sell"} ${input.size} ${input.market.symbol} resting on ${PERP_VENUE_NAMES[venue]}.` },
        );
        return result;
      } catch (error) {
        fail(venue, `Order rejected by ${PERP_VENUE_NAMES[venue]}`, error);
        return null;
      }
    },
    [address, isVenueReady, toast, fail],
  );

  const cancelOrder = useCallback(
    async (order: VenueOpenOrder) => {
      if (!address) return;
      try {
        await venues[order.venue].cancelOrder(address, order);
        toast({ tone: "info", title: `Canceled ${order.symbol} order` });
      } catch (error) {
        fail(order.venue, "Cancel failed", error);
      }
    },
    [address, toast, fail],
  );

  const setPositionTpsl = useCallback(
    async (position: VenuePosition, levels: PositionTpsl) => {
      if (!address) return false;
      if (!isVenueReady(position.venue)) {
        setSetupVenue(position.venue);
        return false;
      }
      try {
        await venues[position.venue].setPositionTpsl(address, position, levels);
        const parts = [levels.takeProfit && `TP ${formatPrice(levels.takeProfit)}`, levels.stopLoss && `SL ${formatPrice(levels.stopLoss)}`].filter(Boolean);
        toast({ tone: "success", title: `${position.symbol} TP/SL set`, message: `${parts.join(" · ")} on ${PERP_VENUE_NAMES[position.venue]}` });
        return true;
      } catch (error) {
        fail(position.venue, "TP/SL rejected", error);
        return false;
      }
    },
    [address, isVenueReady, toast, fail],
  );

  const withdrawHyperliquid = useCallback(
    async (amount: string) => {
      if (!address || !getWalletClient) return false;
      try {
        await withdrawUsdc(await getWalletClient(), address, amount);
        toast({ tone: "success", title: `Withdrawing ${amount} USDC`, message: "It arrives in your wallet on Arbitrum in 3-4 minutes (1 USDC fee)." });
        return true;
      } catch (error) {
        fail("hyperliquid", "Withdrawal failed", error);
        return false;
      }
    },
    [address, getWalletClient, toast, fail],
  );

  const closePosition = useCallback(
    async (position: VenuePosition) => {
      if (!address) return;
      if (!isVenueReady(position.venue)) return setSetupVenue(position.venue);
      try {
        const result = await venues[position.venue].closePosition(address, position);
        trackPerpOrder(result, { venue: position.venue, side: position.size > 0 ? "sell" : "buy", newsId: null, oneClick: false });
        toast({
          tone: "success",
          title: `Closed ${position.symbol}`,
          message: result.status === "filled" ? `Average price ${formatPrice(result.avgPx)}` : undefined,
        });
      } catch (error) {
        fail(position.venue, "Close failed", error);
      }
    },
    [address, isVenueReady, toast, fail],
  );

  const accounts = useMemo(
    () => ({
      hyperliquid: hlAccount,
      ...(lighterEnabled ? { lighter: lighterCore.account } : {}),
      ...(lighterRhEnabled ? { lighterRh: lighterRh.account } : {}),
      ...(asterEnabled ? { aster: aster.account } : {}),
      ...(orderlyEnabled ? { orderly: orderly.account } : {}),
    }),
    [hlAccount, lighterCore.account, lighterEnabled, lighterRh.account, lighterRhEnabled, asterEnabled, aster.account, orderlyEnabled, orderly.account],
  );

  const account = useMemo<AccountSnapshot | null>(() => {
    const snapshots = Object.values(accounts).filter((snapshot): snapshot is AccountSnapshot => snapshot !== null);
    if (snapshots.length === 0) return null;
    return {
      positions: snapshots.flatMap((snapshot) => snapshot.positions),
      orders: snapshots.flatMap((snapshot) => snapshot.orders).sort((a, b) => b.timestamp - a.timestamp),
      accountValue: snapshots.reduce((sum, snapshot) => sum + snapshot.accountValue, 0),
      withdrawable: snapshots.reduce((sum, snapshot) => sum + snapshot.withdrawable, 0),
    };
  }, [accounts]);

  const value = useMemo<TradingContextValue>(
    () => ({
      network: hlConfig.network,
      lighterNetwork: lighterConfig.network,
      markets,
      market,
      marketsByVenue,
      perpOrder,
      onboarding,
      lighter,
      lighterStates,
      isReady,
      isVenueReady,
      account,
      accounts,
      setupVenue,
      isSetupOpen: setupVenue !== null,
      openSetup: (venue: PerpVenueId = "hyperliquid") => setSetupVenue(venue),
      closeSetup: () => setSetupVenue(null),
      approveBuilder,
      createAgent,
      revoke,
      refreshLighter,
      registerLighter,
      approveLighter,
      revokeLighter,
      aster: aster.state,
      approveAster: aster.approve,
      revokeAster: aster.revoke,
      orderly: orderly.state,
      approveOrderly: orderly.approve,
      revokeOrderly: orderly.revoke,
      placeOrder,
      cancelOrder,
      closePosition,
      setPositionTpsl,
      depositVenue,
      depositMode,
      openDeposit,
      closeDeposit,
      isProOrderOpen,
      openProOrder,
      closeProOrder,
      withdrawHyperliquid,
    }),
    [
      markets,
      market,
      marketsByVenue,
      perpOrder,
      onboarding,
      lighter,
      lighterStates,
      isReady,
      isVenueReady,
      account,
      accounts,
      setupVenue,
      approveBuilder,
      createAgent,
      revoke,
      refreshLighter,
      registerLighter,
      approveLighter,
      revokeLighter,
      aster.state,
      aster.approve,
      aster.revoke,
      orderly.state,
      orderly.approve,
      orderly.revoke,
      placeOrder,
      cancelOrder,
      closePosition,
      setPositionTpsl,
      depositVenue,
      depositMode,
      openDeposit,
      closeDeposit,
      isProOrderOpen,
      openProOrder,
      closeProOrder,
      withdrawHyperliquid,
    ],
  );

  return <TradingContext.Provider value={value}>{children}</TradingContext.Provider>;
}
