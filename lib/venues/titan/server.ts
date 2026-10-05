import "server-only";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { jupServerConfig } from "../jupiter/server";
import type { TitanRoute } from "./route";

export const TITAN_API_URL = "https://portal.api.titan.exchange";
const TIMEOUT_MS = 10_000;
const U64_MAX = BigInt("18446744073709551615");

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

export function solanaConnection() {
  return new Connection(jupServerConfig().rpcUrl, "confirmed");
}

/**
 * Titan returns instructions, not a transaction: assemble an unsigned v0 transaction for the taker with a fresh
 * blockhash, adding a compute limit when the route has none.
 */
export async function buildTitanTransaction(route: TitanRoute, taker: string) {
  const instructions = route.instructions.map(
    (instruction) =>
      new TransactionInstruction({
        programId: new PublicKey(instruction.p),
        keys: instruction.a.map((key) => ({ pubkey: new PublicKey(key.p), isSigner: key.s, isWritable: key.w })),
        data: Buffer.from(instruction.d, "base64"),
      }),
  );
  if (route.computeUnitsSafe > 0 && !instructions.some((instruction) => instruction.programId.equals(ComputeBudgetProgram.programId))) {
    instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: route.computeUnitsSafe }));
  }
  const lookupTables = route.lookupTables.map(
    (table) =>
      new AddressLookupTableAccount({
        key: new PublicKey(table.key),
        state: {
          deactivationSlot: U64_MAX,
          lastExtendedSlot: 0,
          lastExtendedSlotStartIndex: 0,
          addresses: table.addresses.map((address) => new PublicKey(address)),
        },
      }),
  );
  const { blockhash, lastValidBlockHeight } = await solanaConnection().getLatestBlockhash("confirmed");
  const message = new TransactionMessage({ payerKey: new PublicKey(taker), recentBlockhash: blockhash, instructions }).compileToV0Message(lookupTables);
  return { transaction: Buffer.from(new VersionedTransaction(message).serialize()).toString("base64"), lastValidBlockHeight };
}
