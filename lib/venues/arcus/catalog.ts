"use client";

import { VenueError } from "../types";
import { arcusConfig } from "./config";
import { arcusErrorMessage } from "./quote";
import { findArcusToken, findQuoteToken, readArcusTokens, type ArcusToken } from "./tokens";

/** Router calls and token lookups through /api/arcus, without viem or the SDK so the resolver stays light. */

const TOKEN_TTL_MS = 5 * 60_000;

let tokenCache: { at: number; promise: Promise<ArcusToken[]> } | null = null;

export async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/arcus/${path}`, { cache: "no-store", ...init });
  } catch {
    throw new VenueError("Arcus is unreachable right now.");
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {}
  if (!response.ok) {
    const code = typeof body.code === "string" ? body.code : undefined;
    const message = typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : `Arcus request failed (${response.status}).`;
    throw new VenueError(arcusErrorMessage(code, message), code);
  }
  return body as T;
}

export function loadArcusTokens() {
  if (tokenCache && Date.now() - tokenCache.at < TOKEN_TTL_MS) return tokenCache.promise;
  const promise = call<unknown>("tokens").then(readArcusTokens);
  tokenCache = { at: Date.now(), promise };
  promise.catch(() => (tokenCache = null));
  return promise;
}

export async function resolveArcusToken(symbol: string) {
  return findArcusToken(await loadArcusTokens(), symbol);
}

export async function arcusQuoteToken() {
  const token = findQuoteToken(await loadArcusTokens(), arcusConfig.quoteSymbol);
  if (!token) throw new VenueError(`${arcusConfig.quoteSymbol} isn't available on Arcus right now.`);
  return token;
}

