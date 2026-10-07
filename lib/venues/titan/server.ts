import "server-only";
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  blockhash as toBlockhash,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Instruction,
} from "@solana/kit";
import { jupServerConfig } from "../jupiter/server";
import type { TitanRoute } from "./route";

export const TITAN_API_URL = "https://portal.api.titan.exchange";
const TIMEOUT_MS = 10_000;
const COMPUTE_BUDGET_PROGRAM = address("ComputeBudget111111111111111111111111111111");

/** Titan is optional: without TITAN_API_KEY every spot trade goes to Jupiter alone. */
export function readTitanServerConfig(env: Record<string, string | undefined>) {
  return { apiKey: env.TITAN_API_KEY?.trim() || null, apiUrl: (env.TITAN_API_URL || TITAN_API_URL).replace(/\/+$/, "") };
}

export function titanFetch(path: string) {
  const { apiKey, apiUrl } = readTitanServerConfig(process.env);
  // Without Accept: application/json the Portal answers MessagePack.
  return fetch(`${apiUrl}${path}`, {
    headers: { accept: "application/json", "x-api-key": apiKey ?? "" },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/** Solana RPC (`SOLANA_RPC_URL`) through @solana/kit, the maintained successor of @solana/web3.js. */
export function solanaRpc() {
  return createSolanaRpc(jupServerConfig().rpcUrl);
}

/** ComputeBudget SetComputeUnitLimit: instruction 2 followed by the unit count as a little-endian u32. */
function setComputeUnitLimit(units: number): Instruction {
  const data = new Uint8Array(5);
  data[0] = 2;
  new DataView(data.buffer).setUint32(1, units, true);
  return { programAddress: COMPUTE_BUDGET_PROGRAM, accounts: [], data };
}

function accountRole(isSigner: boolean, isWritable: boolean) {
  if (isSigner) return isWritable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER;
  return isWritable ? AccountRole.WRITABLE : AccountRole.READONLY;
}

/**
 * Titan returns instructions, not a transaction: assemble an unsigned v0 transaction for the taker with a fresh
 * blockhash, adding a compute limit when the route has none.
 */
export async function buildTitanTransaction(route: TitanRoute, taker: string) {
  const { value } = await solanaRpc().getLatestBlockhash({ commitment: "confirmed" }).send();
  return { transaction: compileTitanTransaction(route, taker, value.blockhash), lastValidBlockHeight: Number(value.lastValidBlockHeight) };
}

/** The unsigned v0 transaction as base64 (pure, so tests pin its exact bytes). */
export function compileTitanTransaction(route: TitanRoute, taker: string, blockhash: string) {
  const instructions: Instruction[] = route.instructions.map((instruction) => ({
    programAddress: address(instruction.p),
    accounts: instruction.a.map((key) => ({ address: address(key.p), role: accountRole(key.s, key.w) })),
    data: new Uint8Array(Buffer.from(instruction.d, "base64")),
  }));
  if (route.computeUnitsSafe > 0 && !instructions.some((instruction) => instruction.programAddress === COMPUTE_BUDGET_PROGRAM)) {
    instructions.unshift(setComputeUnitLimit(route.computeUnitsSafe));
  }
  const lookupTables: Record<Address, Address[]> = Object.fromEntries(
    route.lookupTables.map((table) => [address(table.key), table.addresses.map((entry) => address(entry))]),
  );
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (draft) => setTransactionMessageFeePayer(address(taker), draft),
    // Only the blockhash is compiled into the message; the height is the caller's.
    (draft) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: toBlockhash(blockhash), lastValidBlockHeight: 0n }, draft),
    (draft) => appendTransactionMessageInstructions(instructions, draft),
    (draft) => compressTransactionMessageUsingAddressLookupTables(draft, lookupTables),
  );
  return getBase64EncodedWireTransaction(compileTransaction(message));
}
