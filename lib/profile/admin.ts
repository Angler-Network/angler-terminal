import "server-only";

/**
 * Admin wallets (`ANGLER_ADMINS`, comma-separated EVM or Solana addresses): they always get in during the closed beta
 * and can create as many invite codes as they like.
 */
export function isAdmin(id: string) {
  const admins = (process.env.ANGLER_ADMINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return admins.some((admin) => (admin.startsWith("0x") ? admin.toLowerCase() === id.toLowerCase() : admin === id));
}
