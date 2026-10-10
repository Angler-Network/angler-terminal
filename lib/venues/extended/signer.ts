"use client";

import { VenueError } from "../types";
import { EXTENDED_STARK_DOMAIN, extendedConfig } from "./config";

/**
 * Extended's official Stark signer (`@x10xchange/stark-crypto-wrapper-wasm`, pinned; its .wasm copied to
 * `public/extended/`), loaded with the first signature, never with the page. `@scure/starknet` adds what the WASM
 * doesn't export: the public key and the pedersen hash for registration.
 */

const WASM_URL = "/extended/stark-crypto-0.2.0.wasm";

type StarkWasm = typeof import("@x10xchange/stark-crypto-wrapper-wasm");
let loading: Promise<StarkWasm> | null = null;

function stark() {
  loading ??= import("@x10xchange/stark-crypto-wrapper-wasm").then(async (wasm) => {
    await wasm.default({ module_or_path: WASM_URL });
    return wasm;
  });
  loading.catch(() => (loading = null));
  return loading;
}

const hex = (value: bigint | string) => `0x${BigInt(value).toString(16)}`;

/** The account's Stark key pair from the wallet's key-derivation signature (deterministic: same signature, same key). */
export async function starkKeyFromSignature(signature: string) {
  const [wasm, { getStarkKey }] = await Promise.all([stark(), import("@scure/starknet")]);
  const privateKey = wasm.generate_private_key_from_eth_signature(signature);
  return { privateKey, publicKey: hex(getStarkKey(privateKey)) };
}

export async function signStark(privateKey: string, hash: string) {
  const wasm = await stark();
  const signature = wasm.sign_message(privateKey, hash);
  return { r: signature.r, s: signature.s };
}

/** Registration's L2 signature: the Stark key signs pedersen(wallet, public key). */
export async function registrationSignature(privateKey: string, publicKey: string, wallet: string) {
  const { pedersen } = await import("@scure/starknet");
  return signStark(privateKey, hex(pedersen(BigInt(wallet), BigInt(publicKey))));
}

export interface OrderHashInput {
  vault: string;
  syntheticId: string;
  synthetic: bigint;
  collateralId: string;
  collateral: bigint;
  fee: bigint;
  expiration: number;
  nonce: number;
  publicKey: string;
}

/** The order message hash Extended verifies (perpetual orders; collateral pays the fee). */
export async function orderHash(input: OrderHashInput) {
  const wasm = await stark();
  try {
    return wasm.get_order_msg(
      input.vault,
      input.syntheticId,
      input.synthetic.toString(),
      input.collateralId,
      input.collateral.toString(),
      input.collateralId,
      input.fee.toString(),
      String(input.expiration),
      String(input.nonce),
      input.publicKey,
      EXTENDED_STARK_DOMAIN.name,
      EXTENDED_STARK_DOMAIN.version,
      extendedConfig.chainId,
      EXTENDED_STARK_DOMAIN.revision,
    );
  } catch (error) {
    throw new VenueError(`Extended signer: ${error instanceof Error ? error.message : String(error)}`);
  }
}
