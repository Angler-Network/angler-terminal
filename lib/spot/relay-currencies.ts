/**
 * Relay's token search (`POST /currencies/v2`, no key): tokens by name, ticker or address on the EVM swap chains, with
 * decimals and logos. It backs the EVM side of the market search (DexScreener's search goes silent for rate-limited
 * IPs). Hits are listed unverified unless the Uniswap list carries them. Pure, unit-tested.
 */
import { evmSwapChain } from "@/lib/venues/uniswap/chains";
import { uniswapListingId, type SpotListing } from "./listings";

export function relayCurrenciesBody(term: string, chainIds: number[], limit = 30) {
  return { chainIds, term, limit };
}

export function readRelayCurrencies(body: unknown): SpotListing[] {
  if (!Array.isArray(body)) return [];
  const seen = new Set<string>();
  return body.flatMap((entry) => {
    const record = (entry ?? {}) as Record<string, unknown>;
    const chain = typeof record.chainId === "number" ? evmSwapChain(record.chainId) : null;
    const address = typeof record.address === "string" ? record.address : "";
    if (!chain || !/^0x[0-9a-fA-F]{40}$/.test(address) || typeof record.symbol !== "string" || !record.symbol || typeof record.decimals !== "number") return [];
    const id = uniswapListingId(chain.id, address);
    if (seen.has(id)) return [];
    seen.add(id);
    const metadata = (record.metadata ?? {}) as { logoURI?: unknown };
    return [
      {
        id,
        venue: "uniswap" as const,
        address,
        chainId: chain.id,
        decimals: record.decimals,
        symbol: record.symbol,
        name: typeof record.name === "string" && record.name ? record.name : record.symbol,
        icon: typeof metadata.logoURI === "string" && metadata.logoURI.startsWith("https://") ? metadata.logoURI : undefined,
        category: "crypto" as const,
        verified: false,
      },
    ];
  });
}
