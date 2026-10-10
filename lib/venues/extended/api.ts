"use client";

import { VenueError } from "../types";
import { extendedConfig } from "./config";

/**
 * Extended's REST API through our proxy (`/api/extended/<network>/<path>`): it sends no CORS headers, so the browser
 * can't call it directly. The proxy refuses Extended's restricted countries (451 with `restricted: true`).
 */

interface Envelope<T> {
  status?: string;
  data?: T;
  error?: { code?: number | string; message?: string } | string;
  restricted?: boolean;
}

export class ExtendedRestrictedError extends VenueError {}

export async function extendedApi<T>(path: string, init: { method?: string; body?: unknown; apiKey?: string; headers?: Record<string, string> } = {}): Promise<T> {
  const response = await fetch(`${extendedConfig.proxy}/${extendedConfig.network}${path}`, {
    method: init.method ?? "GET",
    cache: "no-store",
    headers: {
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(init.apiKey ? { "x-api-key": init.apiKey } : {}),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  let body: Envelope<T> = {};
  try {
    body = text ? (JSON.parse(text) as Envelope<T>) : {};
  } catch {}
  if (body.restricted) throw new ExtendedRestrictedError("Extended isn't available in your country.");
  if (!response.ok || body.status === "ERROR") {
    const error = typeof body.error === "string" ? body.error : body.error?.message;
    const code = typeof body.error === "object" && body.error?.code !== undefined ? String(body.error.code) : undefined;
    throw new VenueError(error ? `Extended: ${error}` : `Extended answered ${response.status}.`, code ?? String(response.status));
  }
  return body.data as T;
}

/** The same request, or null when Extended answers 404 (an empty balance answers 404). */
export async function extendedApiOrNull<T>(path: string, init: Parameters<typeof extendedApi>[1] = {}): Promise<T | null> {
  try {
    return await extendedApi<T>(path, init);
  } catch (error) {
    if (error instanceof VenueError && error.raw === "404") return null;
    throw error;
  }
}
