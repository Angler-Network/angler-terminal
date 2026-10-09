import "server-only";
import { NextResponse } from "next/server";

const DEFAULT_API_URL = "https://api.angler.network";
const DEFAULT_WS_URL = "wss://ws.angler.network/connection/websocket";
/** After a failed call, every route answers "down" at once for this long instead of waiting on the API again. */
const DOWN_MS = 30_000;

/**
 * Server-only Angler API settings. The key never leaves the server. `ANGLER_API_PAUSED=1` turns the news API off on
 * purpose (it reads as no key: nothing calls it), and the browser shows "News is paused" instead of an error.
 */
export function anglerConfig() {
  const key = process.env.ANGLER_API_KEY;
  const paused = process.env.ANGLER_API_PAUSED?.trim() === "1";
  return {
    apiUrl: (process.env.ANGLER_API_URL || DEFAULT_API_URL).replace(/\/+$/, ""),
    wsUrl: process.env.ANGLER_WS_URL || DEFAULT_WS_URL,
    paused,
    key: !paused && key && key.trim() ? key.trim() : null,
  };
}

export const missingKeyResponse = { error: "ANGLER_API_KEY is not set on the server. Copy .env.example to .env.local." };

/** The 503 a route answers when the news API can't be used: paused on purpose, or no key. */
export function anglerOffResponse() {
  return anglerConfig().paused
    ? NextResponse.json({ paused: true, error: "Angler news is paused." }, { status: 503, headers: { "cache-control": "public, max-age=60, s-maxage=60" } })
    : NextResponse.json(missingKeyResponse, { status: 503 });
}

let downUntil = 0;

/** Whether a call failed in the last `DOWN_MS` (per instance): a down API then costs no 10-second timeouts. */
export function anglerDown(now = Date.now()) {
  return now < downUntil;
}

export function markAnglerDown(now = Date.now()) {
  downUntil = now + DOWN_MS;
}
