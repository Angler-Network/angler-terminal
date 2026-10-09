/**
 * Relay and LI.FI routes placed through the terminal, read from their own records (pure, unit-tested; the reads are in
 * `bridge-points-server.ts`). Neither pays our fee in the transaction itself (Relay accrues app fees in its balance,
 * LI.FI in its fee collector), so the proof is the record: a Relay request whose app fees name our recipient, a LI.FI
 * transfer tagged with our integrator. Volume is what the user sent, in USD as the bridge priced it.
 */

export interface BridgeClaim {
  /** The sender: an EVM address (lowercase) or a Solana address. */
  user: string;
  usd: number;
}

const EVM = /^0x[0-9a-fA-F]{40}$/;
const SOLANA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function readUser(value: unknown) {
  if (typeof value !== "string") return null;
  if (EVM.test(value)) return value.toLowerCase();
  return SOLANA.test(value) ? value : null;
}

/** A finished Relay request (`/requests/v2?id=`) that carried our app fee to `recipient`, with that fee's bps. */
export function readRelayRequest(body: unknown, recipient: string): (BridgeClaim & { bps: number }) | null {
  const request = (body as { requests?: unknown[] } | null)?.requests?.[0] as
    | { status?: unknown; user?: unknown; data?: { appFees?: unknown; metadata?: { currencyIn?: { amountUsd?: unknown } } } }
    | undefined;
  if (!request || request.status !== "success") return null;
  const fees = Array.isArray(request.data?.appFees) ? (request.data.appFees as Array<{ recipient?: unknown; bps?: unknown }>) : [];
  const ours = fees.find((fee) => typeof fee.recipient === "string" && fee.recipient.toLowerCase() === recipient.toLowerCase());
  const bps = Number(ours?.bps);
  const usd = Number(request.data?.metadata?.currencyIn?.amountUsd);
  const user = readUser(request.user);
  return ours && bps > 0 && usd > 0 && user ? { user, usd, bps } : null;
}

/** A finished LI.FI transfer (`/v1/status?txHash=`) tagged with our `integrator`. */
export function readLifiTransfer(body: unknown, integrator: string): BridgeClaim | null {
  const transfer = body as { status?: unknown; fromAddress?: unknown; metadata?: { integrator?: unknown }; sending?: { amountUSD?: unknown } } | null;
  if (!transfer || transfer.status !== "DONE" || transfer.metadata?.integrator !== integrator) return null;
  const usd = Number(transfer.sending?.amountUSD);
  const user = readUser(transfer.fromAddress);
  return usd > 0 && user ? { user, usd } : null;
}
