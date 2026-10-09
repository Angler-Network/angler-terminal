import { concat, encodeAbiParameters, getContractAddress, keccak256, numberToHex, pad, type Hex } from "viem";

/**
 * The Polymarket Deposit Wallet a signer's account trades from, computed like `@polymarket/client` 0.12 does (CREATE2
 * from the deposit wallet factory, salted with the signer; `deposit-wallet.test.ts` checks it against the SDK). The SDK
 * uses the beacon proxy when the factory has a beacon and the implementation proxy otherwise, so both are candidates:
 * builder trades are matched against either. Polygon mainnet addresses from the SDK's environment.
 */

const FACTORY: Hex = "0x00000000000Fb5C9ADea0298D729A0CB3823Cc07";
const BEACON: Hex = "0x7A18EDfe055488A3128f01F563e5B479D92ffc3a";
const IMPLEMENTATION: Hex = "0x58CA52ebe0DadfdF531Cde7062e76746de4Db1eB";

// Proxy creation code pieces, as in the SDK.
const BEACON_HEAD = BigInt("0x6100523d8160233d3973");
const BEACON_PARTS: Hex[] = ["0x60195155f3363d3d373d3d363d602036600436635c60da", "0x1b60e01b36527fa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6c", "0xb3582b35133d50545afa5036515af43d6000803e604d573d6000fd5b3d6000f3"];
const PROXY_HEAD = BigInt("0x61003d3d8160233d3973");
const PROXY_PARTS: Hex[] = ["0x6009", "0x5155f3363d3d373d3d363d7f360894a13ba1a3210667c828492db98dca3e2076", "0xcc3735a920a3ca505d382bbc545af43d6000803e6038573d6000fd5b3d6000f3"];

function derive(signer: Hex, target: Hex, head: bigint, parts: Hex[], factory = FACTORY) {
  const args = encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [factory, pad(signer, { size: 32 })]);
  const length = BigInt((args.length - 2) / 2);
  const bytecodeHash = keccak256(concat([numberToHex(head + (length << BigInt(56)), { size: 10 }), target, ...parts, args]));
  return getContractAddress({ opcode: "CREATE2", from: factory, salt: keccak256(args), bytecodeHash }).toLowerCase();
}

/** Both addresses the signer's Deposit Wallet can have (beacon proxy, implementation proxy), lowercase. */
export function depositWalletCandidates(signer: Hex) {
  return [derive(signer, BEACON, BEACON_HEAD, BEACON_PARTS), derive(signer, IMPLEMENTATION, PROXY_HEAD, PROXY_PARTS)];
}
