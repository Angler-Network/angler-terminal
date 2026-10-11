/**
 * QFEX's HMAC authentication, the same for REST headers and the Trade WebSocket's auth message: HMAC-SHA256 of
 * `${nonce}:${unixSeconds}` with the API secret, hex. The nonce is random hex, unique within 15 minutes. WebCrypto, so
 * the secret never leaves the browser.
 */

const toHex = (bytes: Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

export async function qfexSignature(secret: string, nonce: string, unixTs: number, subtle: SubtleCrypto = crypto.subtle) {
  const key = await subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(new Uint8Array(await subtle.sign("HMAC", key, new TextEncoder().encode(`${nonce}:${unixTs}`))));
}

export function qfexNonce() {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

/** The four REST headers for one request. */
export async function qfexHeaders(publicKey: string, secret: string): Promise<Record<string, string>> {
  const nonce = qfexNonce();
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    "x-qfex-public-key": publicKey,
    "x-qfex-nonce": nonce,
    "x-qfex-timestamp": String(timestamp),
    "x-qfex-hmac-signature": await qfexSignature(secret, nonce, timestamp),
  };
}

/** The Trade WebSocket's auth message, with our builder code when one is set. */
export async function qfexAuthMessage(publicKey: string, secret: string, builderCode: string | null) {
  const nonce = qfexNonce();
  const unixTs = Math.floor(Date.now() / 1000);
  return {
    type: "auth",
    params: {
      hmac: { public_key: publicKey, nonce, unix_ts: unixTs, signature: await qfexSignature(secret, nonce, unixTs) },
      ...(builderCode ? { builder_code: builderCode } : {}),
    },
  };
}
