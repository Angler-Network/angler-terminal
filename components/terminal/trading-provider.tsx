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
import { lighterConfig } from "@/lib/venues/lighter/config";
import { toLighterVenueError } from "@/lib/venues/lighter/errors";
import {
  approveLighterIntegrator,
  getLighterOnboarding,
  registerLighterKey,
  revokeLighterKey,
  type LighterOnboarding,
} from "@/lib/venues/lighter/onboarding";
import { lighterVenue } from "@/lib/venues/lighter/venue";
import { PERP_VENUE_NAMES, perpVenueOrder, type MarketsByVenue } from "@/lib/venues/routing";
import type {
  AccountSnapshot,
  PositionTpsl,
  PerpVenue,
  PerpVenueId,
  PlaceOrderInput,
  VenueMarket,
  VenueOpenOrder,
  VenuePosition,
} from "@/lib/venues/types";
import { formatPrice } from "@/lib/format";
import { useSelectedAsset } from "./selected-asset";
import { useWallet } from "./wallet-provider";

const venues: Record<PerpVenueId, PerpVenue> = { hyperliquid: hyperliquidVenue, lighter: lighterVenue };

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
  lighter: LighterOnboarding | null;
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
  refreshLighter: () => Promise<void>;
  registerLighter: () => Promise<boolean>;
  approveLighter: () => Promise<boolean>;
  revokeLighter: () => Promise<void>;
  placeOrder: (input: PlaceOrderInput) => Promise<boolean>;
  cancelOrder: (order: VenueOpenOrder) => Promise<void>;
  closePosition: (position: VenuePosition) => Promise<void>;
  setPositionTpsl: (position: VenuePosition, levels: PositionTpsl) => Promise<boolean>;
  /** Venue the deposit window is open for, or null. */
  depositVenue: PerpVenueId | null;
  openDeposit: (venue: PerpVenueId) => void;
  closeDeposit: () => void;
  withdrawHyperliquid: (amount: string) => Promise<boolean>;
}

const TradingContext = createContext<TradingContextValue | null>(null);

export function useTrading() {
  const context = useContext(TradingContext);
  if (!context) throw new Error("useTrading must be used within TradingProvider");
  return context;
}

function venueError(venue: PerpVenueId, error: unknown) {
  return venue === "lighter" ? toLighterVenueError(error) : toVenueError(error);
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

export function TradingProvider({ children }: { children: React.ReactNode }) {
  const toast = useToast();
  const { preferences } = usePreferences();
  const { address, getWalletClient } = useWallet();
  const { symbol } = useSelectedAsset();
  const lighterEnabled = preferences.venueLighter;
  // Hyperliquid markets also feed the chart, so they load even when Hyperliquid trading is off.
  const markets = useVenueMarkets(hyperliquidVenue, true);
  const lighterMarkets = useVenueMarkets(lighterVenue, lighterEnabled);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [lighter, setLighter] = useState<LighterOnboarding | null>(null);
  const [hlAccount, setHlAccount] = useState<AccountSnapshot | null>(null);
  const [lighterAccount, setLighterAccount] = useState<AccountSnapshot | null>(null);
  const [setupVenue, setSetupVenue] = useState<PerpVenueId | null>(null);
  const [depositVenue, setDepositVenue] = useState<PerpVenueId | null>(null);
  const openDeposit = useCallback((venue: PerpVenueId) => setDepositVenue(venue), []);
  const closeDeposit = useCallback(() => setDepositVenue(null), []);

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

  const marketsByVenue = useMemo<MarketsByVenue>(
    () => ({
      hyperliquid: preferences.venueHyperliquid ? (markets ?? undefined) : [],
      lighter: lighterEnabled ? (lighterMarkets ?? undefined) : [],
    }),
    [preferences.venueHyperliquid, markets, lighterEnabled, lighterMarkets],
  );

  const perpOrder = useMemo(
    () => perpVenueOrder(preferences.preferredPerpVenue, { hyperliquid: preferences.venueHyperliquid, lighter: lighterEnabled }),
    [preferences.preferredPerpVenue, preferences.venueHyperliquid, lighterEnabled],
  );

  const refreshOnboarding = useCallback(async () => {
    if (!address) return setOnboarding(null);
    try {
      setOnboarding(await getOnboardingStatus(address));
    } catch {
      setOnboarding({ builderApproved: false, agentAddress: null });
    }
  }, [address]);

  const refreshLighter = useCallback(async () => {
    if (!address || !lighterEnabled) return setLighter(null);
    try {
      setLighter(await getLighterOnboarding(address));
    } catch {
      setLighter({ accountIndex: null, keyReady: false, integrator: lighterConfig.integrator ? "needed" : "none" });
    }
  }, [address, lighterEnabled]);

  useEffect(() => {
    setOnboarding(null);
    void refreshOnboarding();
  }, [refreshOnboarding]);

  useEffect(() => {
    setLighter(null);
    void refreshLighter();
  }, [refreshLighter]);

  useEffect(() => {
    setHlAccount(null);
    if (!address) return;
    return hyperliquidVenue.subscribeAccount(address, {
      onSnapshot: setHlAccount,
      onError: (error) => fail("hyperliquid", "Live account updates failed", error),
    });
  }, [address, fail]);

  // Resubscribes once a key is registered: open orders need an auth token signed by it.
  const lighterKeyReady = Boolean(lighter?.keyReady);
  useEffect(() => {
    setLighterAccount(null);
    if (!address || !lighterEnabled) return;
    return lighterVenue.subscribeAccount(address, {
      onSnapshot: setLighterAccount,
      onError: (error) => console.warn(`[lighter] account stream: ${toLighterVenueError(error).message}`),
    });
  }, [address, lighterEnabled, lighterKeyReady]);

  const isReady = Boolean(onboarding?.builderApproved && onboarding.agentAddress);
  const lighterReady = Boolean(lighter && lighter.accountIndex !== null && lighter.keyReady && lighter.integrator !== "needed");
  const isVenueReady = useCallback((venue: PerpVenueId) => (venue === "lighter" ? lighterReady : isReady), [isReady, lighterReady]);

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

  const signMessage = useCallback(
    async (message: string) => {
      if (!getWalletClient) throw new Error("Connect an EVM wallet first.");
      return (await getWalletClient()).signMessage({ message });
    },
    [getWalletClient],
  );

  const registerLighter = useCallback(async () => {
    if (!address || !getWalletClient) return false;
    try {
      await registerLighterKey(signMessage, address);
      await refreshLighter();
      toast({ tone: "success", title: "Lighter trading key active", message: "Lighter orders now sign in the browser without a wallet popup." });
      return true;
    } catch (error) {
      fail("lighter", "Couldn't register the Lighter key", error);
      return false;
    }
  }, [address, getWalletClient, signMessage, refreshLighter, fail, toast]);

  const approveLighter = useCallback(async () => {
    if (!address || !getWalletClient) return false;
    try {
      await approveLighterIntegrator(signMessage, address);
      await refreshLighter();
      return true;
    } catch (error) {
      fail("lighter", "Lighter approval failed", error);
      return false;
    }
  }, [address, getWalletClient, signMessage, refreshLighter, fail]);

  const revokeLighter = useCallback(async () => {
    if (!address || !getWalletClient) return;
    try {
      await revokeLighterKey(signMessage, address);
      await refreshLighter();
      toast({ tone: "info", title: "Lighter trading key revoked" });
    } catch (error) {
      fail("lighter", "Couldn't revoke the Lighter key", error);
    }
  }, [address, getWalletClient, signMessage, refreshLighter, fail, toast]);

  const placeOrder = useCallback(
    async (input: PlaceOrderInput) => {
      if (!address) return false;
      const venue = input.market.venue;
      if (!isVenueReady(venue)) {
        setSetupVenue(venue);
        return false;
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
        return true;
      } catch (error) {
        fail(venue, `Order rejected by ${PERP_VENUE_NAMES[venue]}`, error);
        return false;
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
    () => ({ hyperliquid: hlAccount, ...(lighterEnabled ? { lighter: lighterAccount } : {}) }),
    [hlAccount, lighterAccount, lighterEnabled],
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
      placeOrder,
      cancelOrder,
      closePosition,
      setPositionTpsl,
      depositVenue,
      openDeposit,
      closeDeposit,
      withdrawHyperliquid,
    }),
    [
      markets,
      market,
      marketsByVenue,
      perpOrder,
      onboarding,
      lighter,
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
      placeOrder,
      cancelOrder,
      closePosition,
      setPositionTpsl,
      depositVenue,
      openDeposit,
      closeDeposit,
      withdrawHyperliquid,
    ],
  );

  return <TradingContext.Provider value={value}>{children}</TradingContext.Provider>;
}
