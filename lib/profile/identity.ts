/**
 * Profile identity: a profile is keyed by the wallet that owns it, an EVM address (lowercase) or a Solana address.
 * Changes are signed by that wallet with a plain-text message (no gas, no login) that names the action and a
 * timestamp; the server accepts it for `MESSAGE_TTL_MS`.
 */

export type ProfileChain = "evm" | "solana";

const EVM_ADDRESS = /^0x[0-9a-f]{40}$/;
/** Base58, 32-byte keys: 32-44 characters. */
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const MESSAGE_TTL_MS = 10 * 60_000;

/** The canonical profile id for an address, or null when it is neither an EVM nor a Solana address. */
export function profileIdOf(address: string): { id: string; chain: ProfileChain } | null {
  const trimmed = address.trim();
  if (EVM_ADDRESS.test(trimmed.toLowerCase())) return { id: trimmed.toLowerCase(), chain: "evm" };
  if (SOLANA_ADDRESS.test(trimmed)) return { id: trimmed, chain: "solana" };
  return null;
}

export function shortAddress(id: string) {
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

/** 3-20 letters, digits or underscores; not only digits, not an address lookalike. */
const USERNAME = /^[A-Za-z0-9_]{3,20}$/;
const RESERVED = new Set(["angler", "admin", "support", "official", "team", "mod", "moderator", "system", "null", "undefined"]);

export function usernameError(name: string): string | null {
  if (!USERNAME.test(name)) return "Use 3-20 letters, digits or underscores.";
  if (/^\d+$/.test(name)) return "Add at least one letter.";
  if (/^0x/i.test(name)) return "Usernames can't start with 0x.";
  if (RESERVED.has(name.toLowerCase())) return "That name is reserved.";
  return null;
}

export type ProfileAction =
  | { kind: "username"; username: string }
  | { kind: "link"; profile: string }
  | { kind: "referral"; code: string }
  | { kind: "session" };

/** A referral code: the referrer's username or wallet address. */
export const REFERRAL_CODE = /^[A-Za-z0-9_]{3,44}$/;

/** The text the wallet signs. Every line is checked on the server, so wording changes need both sides. */
export function profileMessage(action: ProfileAction, address: string, issuedAt: string) {
  const what =
    action.kind === "username"
      ? `Set username: ${action.username}`
      : action.kind === "link"
        ? `Link this wallet to profile: ${action.profile}`
        : action.kind === "referral"
          ? `Use referral code: ${action.code}`
          : "Sign in to Angler";
  return ["Angler Terminal profile", what, `Wallet: ${address}`, `Issued at: ${issuedAt}`].join("\n");
}

/** Reads a signed message back: the action, the signing wallet and when it was issued, or null when malformed. */
export function readProfileMessage(message: string): { action: ProfileAction; address: string; issuedAt: number } | null {
  const lines = message.split("\n");
  if (lines.length !== 4 || lines[0] !== "Angler Terminal profile") return null;
  const wallet = /^Wallet: (\S+)$/.exec(lines[2]);
  const issued = /^Issued at: (\S+)$/.exec(lines[3]);
  const issuedAt = issued ? Date.parse(issued[1]) : Number.NaN;
  if (!wallet || !Number.isFinite(issuedAt)) return null;
  const username = /^Set username: (\S+)$/.exec(lines[1]);
  const link = /^Link this wallet to profile: (\S+)$/.exec(lines[1]);
  const referral = /^Use referral code: (\S+)$/.exec(lines[1]);
  const session = lines[1] === "Sign in to Angler";
  const action: ProfileAction | null = username
    ? { kind: "username", username: username[1] }
    : link
      ? { kind: "link", profile: link[1] }
      : referral
        ? { kind: "referral", code: referral[1] }
        : session
          ? { kind: "session" }
          : null;
  return action ? { action, address: wallet[1], issuedAt } : null;
}

/** Whether a message issued at `issuedAt` may still be used (a minute of clock skew allowed). */
export function isFresh(issuedAt: number, now: number) {
  return issuedAt <= now + 60_000 && now - issuedAt <= MESSAGE_TTL_MS;
}
