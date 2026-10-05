import type { Asset } from "./types";

/** Fallback avatar colors and glyphs for when a market logo fails to load (copied from angler-news). */
export const assets: Record<string, Asset> = {
  BTC: { name: "Bitcoin", kind: "crypto", color: "#f7931a", glyph: "₿" },
  ETH: { name: "Ethereum", kind: "crypto", color: "#3c3c3d", glyph: "Ξ" },
  SOL: { name: "Solana", kind: "crypto", color: "#9945ff", glyph: "◎" },
  HYPE: { name: "Hyperliquid", kind: "crypto", color: "#0f3d36", glyph: "H" },
  COIN: { name: "Coinbase", kind: "stock", color: "#0052ff", glyph: "C" },
  NVDA: { name: "NVIDIA", kind: "stock", color: "#76b900", glyph: "N" },
  AMD: { name: "AMD", kind: "stock", color: "#ed1c24", glyph: "A" },
};
