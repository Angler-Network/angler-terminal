import "server-only";

const DEFAULT_API_URL = "https://api.angler.network";
const DEFAULT_WS_URL = "wss://ws.angler.network/connection/websocket";

/** Server-only Angler API settings. The key never leaves the server. */
export function anglerConfig() {
  const key = process.env.ANGLER_API_KEY;
  return {
    apiUrl: (process.env.ANGLER_API_URL || DEFAULT_API_URL).replace(/\/+$/, ""),
    wsUrl: process.env.ANGLER_WS_URL || DEFAULT_WS_URL,
    key: key && key.trim() ? key.trim() : null,
  };
}

export const missingKeyResponse = { error: "ANGLER_API_KEY is not set on the server. Copy .env.example to .env.local." };
