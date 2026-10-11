"use client";

import { VenueError } from "../types";
import { qfexConfig } from "./config";
import { qfexHeaders } from "./sign";
import type { QfexSession } from "./store";

/** QFEX's REST API through our proxy (`/api/qfex/<path>`): it sends no CORS headers. Account reads are signed here. */
export async function qfexApi<T>(path: string, session?: QfexSession): Promise<T> {
  const response = await fetch(`${qfexConfig.proxy}${path}`, {
    cache: "no-store",
    headers: session ? await qfexHeaders(session.publicKey, session.secret) : undefined,
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {}
  if (!response.ok) {
    const detail = (body as { detail?: string; error?: string } | null)?.detail ?? (body as { error?: string } | null)?.error;
    if (response.status === 401 || response.status === 403) throw new VenueError("QFEX refused the API key. Check it's active and has the view permissions.", String(response.status));
    throw new VenueError(detail ? `QFEX: ${detail}` : `QFEX answered ${response.status}.`, String(response.status));
  }
  return body as T;
}
