import "server-only";
import { NextResponse } from "next/server";
import { JUP_API_URL, readJupServerConfig } from "./config";

export const jupServerConfig = () => readJupServerConfig(process.env);

const TIMEOUT_MS = 15_000;

/** Calls the Jupiter API with the server's key. The key never leaves the server. */
export async function jupFetch(path: string, init: RequestInit = {}) {
  const { apiKey } = jupServerConfig();
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  if (apiKey) headers.set("x-api-key", apiKey);
  const base = (process.env.JUP_API_URL || JUP_API_URL).replace(/\/+$/, "");
  return fetch(`${base}${path}`, { ...init, headers, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
}

/** Passes Jupiter's JSON (or a readable error) through without leaking headers. */
export async function relay(response: Response) {
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: text.slice(0, 300) || `Jupiter responded ${response.status}` };
  }
  return NextResponse.json(body, { status: response.ok ? 200 : response.status, headers: { "cache-control": "no-store" } });
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function unreachable() {
  return NextResponse.json({ error: "Jupiter is unreachable right now." }, { status: 502 });
}
