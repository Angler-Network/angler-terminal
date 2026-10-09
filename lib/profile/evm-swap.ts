/**
 * EVM swaps placed through the terminal, read from the chain so the browser can't inflate them (pure, unit-tested; the
 * reads are in `server.ts`). A swap counts when it succeeded, our fee recipient is in it (in the calldata, where
 * Uniswap's `integratorFees`, 0x's and KyberSwap's fee receiver are encoded, or as the receiver of a token transfer, how
 * Arcus pays its builder fee) and the wallet took part (sent it, or a token left or reached it in a gasless fill).
 */

export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export interface EvmTx {
  from: string;
  to: string | null;
  input: string;
  /** Hex wei. */
  value: string;
  blockNumber: string | null;
}

export interface EvmLog {
  address: string;
  topics: string[];
  data: string;
}

export interface EvmReceipt {
  /** "0x1" on success. */
  status: string;
  logs: EvmLog[];
}

export interface TokenAmount {
  /** Token contract, lowercase; the native coin is the zero address. */
  token: string;
  amount: bigint;
}

export const NATIVE = "0x0000000000000000000000000000000000000000";

const topicAddress = (topic: string | undefined) => (topic && topic.length === 66 ? `0x${topic.slice(26)}`.toLowerCase() : null);

/** ERC-20 transfers in a receipt (ERC-721 transfers carry the id as a topic, not data, and are skipped). */
export function readTransfers(receipt: EvmReceipt) {
  return receipt.logs.flatMap((log) => {
    if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC || log.topics.length !== 3) return [];
    const from = topicAddress(log.topics[1]);
    const to = topicAddress(log.topics[2]);
    if (!from || !to || !/^0x[0-9a-fA-F]+$/.test(log.data)) return [];
    return [{ token: log.address.toLowerCase(), from, to, amount: BigInt(log.data) }];
  });
}

/**
 * The swap's side for the wallet, when it went through one of `recipients` (our fee wallets): what the wallet paid in
 * (native value, else its first token transfer out), what it received (its first token transfer in) and the other token
 * legs (`legs`, to price a swap through a common token when its own sides have no price). Null when the
 * transaction failed, carries none of our recipients, or the wallet had no part in it.
 */
export function readEvmSwap(tx: EvmTx, receipt: EvmReceipt, wallet: string, recipients: string[]) {
  if (receipt.status !== "0x1") return null;
  const owner = wallet.toLowerCase();
  const transfers = readTransfers(receipt);
  const ours = recipients.map((recipient) => recipient.toLowerCase()).filter((recipient) => /^0x[0-9a-f]{40}$/.test(recipient) && recipient !== NATIVE);
  const calldata = tx.input.toLowerCase();
  const recipient = ours.find((address) => calldata.includes(address.slice(2)) || transfers.some((transfer) => transfer.to === address));
  if (!recipient) return null;
  const sent = tx.from.toLowerCase() === owner;
  const out = transfers.find((transfer) => transfer.from === owner);
  const into = transfers.find((transfer) => transfer.to === owner && transfer.from !== owner);
  if (!sent && !out && !into) return null;
  const value = /^0x[0-9a-fA-F]+$/.test(tx.value) ? BigInt(tx.value) : BigInt(0);
  const input: TokenAmount | null = sent && value > BigInt(0) ? { token: NATIVE, amount: value } : out ? { token: out.token, amount: out.amount } : null;
  const output: TokenAmount | null = into ? { token: into.token, amount: into.amount } : null;
  if (!input && !output) return null;
  // Every other token leg, for pricing a swap whose own sides aren't (a meme coin sold for native ETH): fee payments excluded.
  const legs: TokenAmount[] = transfers.filter((transfer) => !ours.includes(transfer.to) && !ours.includes(transfer.from)).map(({ token, amount }) => ({ token, amount }));
  return { recipient, input, output, legs };
}
