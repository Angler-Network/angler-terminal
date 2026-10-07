"use client";

import { TERMINAL_PATHS } from "@/lib/terminal-kind";
import { WALLET_CHAINS, type WalletChain } from "@/lib/venues/bridge-routes";
import { EVM_SWAP_CHAINS, evmRef, type EvmSwapChainKey } from "@/lib/venues/uniswap/chains";

/**
 * Bridging is a swap now: dollar to dollar across chains in the swap card (USDC on Arbitrum → USDC on Base). The
 * sidebar's Bridge, and the funds window when both sides are the wallet, open /swap on the destination chain's USDC
 * with the source chain's dollar as the other side.
 */
export const BRIDGE_EVENT = "angler:bridge";
const BRIDGE_PARAM = "bridge";

export interface BridgePreset {
  from: WalletChain;
  to: EvmSwapChainKey;
}

/** The last bridge opened, so the swap card for that USDC starts with the source chain as the other side. */
let pending: { preset: BridgePreset; mint: string } | null = null;

export function bridgeFromFor(mint: string): WalletChain | null {
  return pending?.mint === mint ? pending.preset.from : null;
}

const isWalletChain = (value: string | undefined): value is WalletChain => (WALLET_CHAINS as readonly string[]).includes(value ?? "");

/** Robinhood Chain has no Uniswap token page here, so a bridge into it lands on Base's USDC instead. */
export function bridgePreset(from: WalletChain = "arbitrum", to: WalletChain = "base"): BridgePreset {
  const target: EvmSwapChainKey = to === "robinhood" || !isWalletChain(to) ? "base" : to;
  if (!isWalletChain(from)) from = "arbitrum";
  return { from: from === target ? (target === "arbitrum" ? "base" : "arbitrum") : from, to: target };
}

/** The asset and token ref the swap card opens on for a bridge. */
export function bridgeAsset(preset: BridgePreset) {
  const chain = EVM_SWAP_CHAINS.find((entry) => entry.key === preset.to)!;
  return { symbol: "USDC", mint: evmRef(chain.id, chain.pay[0].address) };
}

export function openBridge(push: (href: string) => void, from?: WalletChain, to?: WalletChain) {
  const preset = bridgePreset(from, to);
  pending = { preset, mint: bridgeAsset(preset).mint };
  // A mounted terminal takes the event (and cancels it); from other pages the URL carries the preset.
  const handled = !window.dispatchEvent(new CustomEvent<BridgePreset>(BRIDGE_EVENT, { detail: preset, cancelable: true }));
  push(handled ? TERMINAL_PATHS.spot : `${TERMINAL_PATHS.spot}?${BRIDGE_PARAM}=${preset.from}-${preset.to}`);
}

/** A bridge preset from the page's URL (`?bridge=arbitrum-base`), cleared from the address bar once read. */
export function readBridgeParam(): BridgePreset | null {
  const value = new URLSearchParams(window.location.search).get(BRIDGE_PARAM);
  if (!value) return null;
  const url = new URL(window.location.href);
  url.searchParams.delete(BRIDGE_PARAM);
  window.history.replaceState(window.history.state, "", url);
  const [from, to] = value.split("-") as [WalletChain, WalletChain];
  const preset = bridgePreset(from, to);
  pending = { preset, mint: bridgeAsset(preset).mint };
  return preset;
}
