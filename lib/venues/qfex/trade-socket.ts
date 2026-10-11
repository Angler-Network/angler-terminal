"use client";

import { VenueError } from "../types";
import { qfexConfig } from "./config";
import { qfexAuthMessage } from "./sign";
import type { QfexSession } from "./store";

/**
 * One authenticated connection to QFEX's Trade WebSocket per API key, shared by order entry and the account stream.
 * The auth message carries our builder code, so every order sent over this connection is attributed to Angler. After
 * auth it subscribes to `order_responses`, `positions`, `balances` and `fills`. It reconnects while someone listens
 * (with a fresh HMAC and the code again). Requests wait for their own answer (matched by a predicate) or an error frame
 * echoing their type.
 */

export type QfexMessage = Record<string, unknown> & {
  type?: string;
  result?: string;
  err?: { error_code?: string; message?: string | null; incoming_message?: { type?: string; params?: Record<string, unknown> } | null };
};

type Listener = (message: QfexMessage) => void;

const AUTH_TIMEOUT_MS = 10_000;
const RETRY_MS = 3_000;
const CHANNELS = ["order_responses", "positions", "balances", "fills"];

export class QfexTradeSocket {
  private socket: WebSocket | null = null;
  private ready: Promise<void> | null = null;
  private listeners = new Set<Listener>();
  private closed = false;
  private retry: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly session: QfexSession) {}

  /** Connects (once) and resolves when authenticated; rejects with a readable error when QFEX refuses the key. */
  connect(): Promise<void> {
    if (this.ready) return this.ready;
    this.closed = false;
    const ready = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${qfexConfig.tradeWs}?api_key=${encodeURIComponent(this.session.publicKey)}`);
      this.socket = ws;
      let authed = false;
      const timer = setTimeout(() => {
        if (authed) return;
        reject(new VenueError("QFEX didn't confirm the API key. Check it and try again."));
        ws.close();
      }, AUTH_TIMEOUT_MS);
      ws.onopen = () => {
        void qfexAuthMessage(this.session.publicKey, this.session.secret, qfexConfig.builderCode).then((message) => ws.send(JSON.stringify(message)));
      };
      ws.onmessage = (event) => {
        let message: QfexMessage;
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (!authed && message.type === "auth") {
          clearTimeout(timer);
          if (message.result === "success") {
            authed = true;
            ws.send(JSON.stringify({ type: "subscribe", params: { channels: CHANNELS } }));
            resolve();
          } else {
            reject(new VenueError("QFEX refused the API key. Check the key pair and its permissions."));
            ws.close();
          }
          return;
        }
        if (!authed && message.err) {
          clearTimeout(timer);
          reject(new VenueError(`QFEX refused the API key: ${message.err.message ?? message.err.error_code ?? "unknown error"}.`, message.err.error_code));
          ws.close();
          return;
        }
        this.listeners.forEach((listener) => listener(message));
      };
      ws.onclose = () => {
        clearTimeout(timer);
        if (!authed) reject(new VenueError("Couldn't connect to QFEX with this API key."));
        this.socket = null;
        this.ready = null;
        // Listeners (the account stream) keep the connection: reconnect after a pause.
        if (!this.closed && authed && this.listeners.size > 0) this.retry = setTimeout(() => void this.connect().catch(() => {}), RETRY_MS);
      };
      ws.onerror = () => ws.close();
    });
    this.ready = ready;
    ready.catch(() => {
      if (this.ready === ready) this.ready = null;
    });
    return ready;
  }

  listen(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Sends `message` and waits for the first message `match` accepts (its value is returned), or an error frame for
   * the same request type (and client order id, when the request has one).
   */
  async request<T>(message: { type: string; params: Record<string, unknown> }, match: (reply: QfexMessage) => T | undefined, timeoutMs = 10_000): Promise<T> {
    await this.connect();
    return new Promise<T>((resolve, reject) => {
      const clientId = message.params.client_order_id;
      const timer = setTimeout(() => {
        stop();
        reject(new VenueError("QFEX didn't answer in time. Check your orders and positions before trying again."));
      }, timeoutMs);
      const stop = this.listen((reply) => {
        const echoed = reply.err?.incoming_message;
        if (reply.err && echoed?.type === message.type && (clientId === undefined || echoed.params?.client_order_id === clientId)) {
          clearTimeout(timer);
          stop();
          const code = reply.err.error_code ?? "";
          reject(new VenueError(code === "RateLimited" ? "QFEX is rate limiting this account. Wait a moment and try again." : `QFEX: ${reply.err.message ?? code}`, code));
          return;
        }
        const value = match(reply);
        if (value !== undefined) {
          clearTimeout(timer);
          stop();
          resolve(value);
        }
      });
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        clearTimeout(timer);
        stop();
        reject(new VenueError("The QFEX connection dropped. Try again."));
        return;
      }
      this.socket.send(JSON.stringify(message));
    });
  }

  close() {
    this.closed = true;
    clearTimeout(this.retry);
    this.socket?.close();
    this.socket = null;
    this.ready = null;
  }
}

const sockets = new Map<string, QfexTradeSocket>();

/** The shared connection for an API key (one per key, whatever the number of panels using it). */
export function qfexSocket(session: QfexSession) {
  let socket = sockets.get(session.publicKey);
  if (!socket) sockets.set(session.publicKey, (socket = new QfexTradeSocket(session)));
  return socket;
}

export function dropQfexSocket(publicKey: string) {
  sockets.get(publicKey)?.close();
  sockets.delete(publicKey);
}
