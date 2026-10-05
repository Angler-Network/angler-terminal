"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/app/toast-provider";
import { hlConfig } from "@/lib/venues/hyperliquid/config";
import {
  approveAgent,
  approveBuilderFee,
  getOnboardingStatus,
  revokeAgent,
  type OnboardingStatus,
} from "@/lib/venues/hyperliquid/onboarding";
import { hyperliquidVenue } from "@/lib/venues/hyperliquid/venue";
import { toVenueError } from "@/lib/venues/hyperliquid/errors";
import type { AccountSnapshot, PlaceOrderInput, VenueMarket, VenueOpenOrder, VenuePosition } from "@/lib/venues/types";
import { formatPrice } from "@/lib/format";
import { useSelectedAsset } from "./selected-asset";
import { useWallet } from "./wallet-provider";

const venue = hyperliquidVenue;

interface TradingContextValue {
  venueName: string;
  network: "mainnet" | "testnet";
  markets: VenueMarket[] | null;
  /** The venue market for the selected asset, null if the venue doesn't list it, undefined while loading. */
  market: VenueMarket | null | undefined;
  onboarding: OnboardingStatus | null;
  isReady: boolean;
  account: AccountSnapshot | null;
  isSetupOpen: boolean;
  openSetup: () => void;
  closeSetup: () => void;
  approveBuilder: () => Promise<boolean>;
  createAgent: () => Promise<boolean>;
  revoke: () => Promise<void>;
  placeOrder: (input: PlaceOrderInput) => Promise<boolean>;
  cancelOrder: (order: VenueOpenOrder) => Promise<void>;
  closePosition: (position: VenuePosition) => Promise<void>;
}

const TradingContext = createContext<TradingContextValue | null>(null);

export function useTrading() {
  const context = useContext(TradingContext);
  if (!context) throw new Error("useTrading must be used within TradingProvider");
  return context;
}

export function TradingProvider({ children }: { children: React.ReactNode }) {
  const toast = useToast();
  const { address, walletClient } = useWallet();
  const { symbol } = useSelectedAsset();
  const [markets, setMarkets] = useState<VenueMarket[] | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [account, setAccount] = useState<AccountSnapshot | null>(null);
  const [isSetupOpen, setIsSetupOpen] = useState(false);

  const fail = useCallback(
    (title: string, error: unknown) => toast({ tone: "error", title, message: toVenueError(error).message }),
    [toast],
  );

  useEffect(() => {
    let isActive = true;
    venue
      .listMarkets()
      .then((list) => isActive && setMarkets(list))
      .catch(() => isActive && setMarkets([]));
    return () => {
      isActive = false;
    };
  }, []);

  const market = useMemo(() => {
    if (!markets) return undefined;
    const upper = symbol.toUpperCase();
    return (
      markets.find((entry) => entry.symbol === upper && entry.dex === "") ?? markets.find((entry) => entry.symbol === upper) ?? null
    );
  }, [markets, symbol]);

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
    setAccount(null);
    if (!address) return;
    return venue.subscribeAccount(address, {
      onSnapshot: setAccount,
      onError: (error) => fail("Live account updates failed", error),
    });
  }, [address, fail]);

  const isReady = Boolean(onboarding?.builderApproved && onboarding.agentAddress);

  const approveBuilder = useCallback(async () => {
    if (!address || !walletClient) return false;
    try {
      await approveBuilderFee(walletClient, address);
      setOnboarding((current) => ({ agentAddress: current?.agentAddress ?? null, builderApproved: true }));
      return true;
    } catch (error) {
      fail("Builder fee approval failed", error);
      return false;
    }
  }, [address, walletClient, fail]);

  const createAgent = useCallback(async () => {
    if (!address || !walletClient) return false;
    try {
      const agentAddress = await approveAgent(walletClient, address);
      setOnboarding((current) => ({ builderApproved: current?.builderApproved ?? false, agentAddress }));
      toast({ tone: "success", title: "Trading key active", message: "Orders now sign in the browser without a wallet popup." });
      return true;
    } catch (error) {
      fail("Couldn't create the trading key", error);
      return false;
    }
  }, [address, walletClient, fail, toast]);

  const revoke = useCallback(async () => {
    if (!address || !walletClient) return;
    try {
      await revokeAgent(walletClient, address);
      setOnboarding((current) => ({ builderApproved: current?.builderApproved ?? false, agentAddress: null }));
      toast({ tone: "info", title: "Trading key revoked" });
    } catch (error) {
      fail("Couldn't revoke the trading key", error);
    }
  }, [address, walletClient, fail, toast]);

  const placeOrder = useCallback(
    async (input: PlaceOrderInput) => {
      if (!address) return false;
      if (!isReady) {
        setIsSetupOpen(true);
        return false;
      }
      try {
        const result = await venue.placeOrder(address, input);
        const verb = input.side === "buy" ? "Bought" : "Sold";
        toast(
          result.status === "filled"
            ? { tone: "success", title: `${verb} ${result.filledSize} ${input.market.symbol}`, message: `Average price ${formatPrice(result.avgPx)}` }
            : { tone: "success", title: "Order placed", message: `${input.side === "buy" ? "Buy" : "Sell"} ${input.size} ${input.market.symbol} resting on the book.` },
        );
        return true;
      } catch (error) {
        fail("Order rejected", error);
        return false;
      }
    },
    [address, isReady, toast, fail],
  );

  const cancelOrder = useCallback(
    async (order: VenueOpenOrder) => {
      if (!address) return;
      try {
        await venue.cancelOrder(address, order);
        toast({ tone: "info", title: `Canceled ${order.symbol} order` });
      } catch (error) {
        fail("Cancel failed", error);
      }
    },
    [address, toast, fail],
  );

  const closePosition = useCallback(
    async (position: VenuePosition) => {
      if (!address) return;
      if (!isReady) return setIsSetupOpen(true);
      try {
        const result = await venue.closePosition(address, position);
        toast({
          tone: "success",
          title: `Closed ${position.symbol}`,
          message: result.status === "filled" ? `Average price ${formatPrice(result.avgPx)}` : undefined,
        });
      } catch (error) {
        fail("Close failed", error);
      }
    },
    [address, isReady, toast, fail],
  );

  const value = useMemo<TradingContextValue>(
    () => ({
      venueName: venue.name,
      network: hlConfig.network,
      markets,
      market,
      onboarding,
      isReady,
      account,
      isSetupOpen,
      openSetup: () => setIsSetupOpen(true),
      closeSetup: () => setIsSetupOpen(false),
      approveBuilder,
      createAgent,
      revoke,
      placeOrder,
      cancelOrder,
      closePosition,
    }),
    [markets, market, onboarding, isReady, account, isSetupOpen, approveBuilder, createAgent, revoke, placeOrder, cancelOrder, closePosition],
  );

  return <TradingContext.Provider value={value}>{children}</TradingContext.Provider>;
}
