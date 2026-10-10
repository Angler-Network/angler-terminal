import type { ExtendedBalance, ExtendedOrderRow, ExtendedPositionRow } from "./markets";

/**
 * The private account stream (WebSocket v2 JSON-RPC, `scope: "account"`, the API key in the subscribe message so a browser
 * can open it): messages `{ type: "ACCOUNT.POSITION" | "ACCOUNT.ORDER" | "ACCOUNT.BALANCE" | …, data: { isSnapshot, … } }`.
 * A snapshot replaces that part of the account; an update upserts rows by market (positions) or id (orders), dropping
 * closed positions and finished orders.
 */

export interface ExtendedAccountState {
  positions: Map<string, ExtendedPositionRow & { status?: string }>;
  orders: Map<string, ExtendedOrderRow>;
  balance: ExtendedBalance | null;
  /** Set once the stream has sent every part's snapshot it will send (positions, orders, balance). */
  seen: Set<string>;
}

export const emptyAccountState = (): ExtendedAccountState => ({ positions: new Map(), orders: new Map(), balance: null, seen: new Set() });

const FINISHED = new Set(["FILLED", "CANCELLED", "REJECTED", "EXPIRED"]);

export function applyAccountMessage(state: ExtendedAccountState, message: { type?: string; data?: Record<string, unknown> }): ExtendedAccountState {
  const data = message.data ?? {};
  const snapshot = data.isSnapshot === true;
  switch (message.type) {
    case "ACCOUNT.POSITION": {
      const positions = snapshot ? new Map() : new Map(state.positions);
      for (const row of (data.positions as Array<ExtendedPositionRow & { status?: string }>) ?? []) {
        if (row.status === "CLOSED" || !Number(row.size)) positions.delete(row.market);
        else positions.set(row.market, row);
      }
      return { ...state, positions, seen: new Set([...state.seen, "positions"]) };
    }
    case "ACCOUNT.ORDER": {
      const orders = snapshot ? new Map() : new Map(state.orders);
      for (const row of (data.orders as ExtendedOrderRow[]) ?? []) {
        const id = row.externalId ?? String(row.id);
        if (row.status && FINISHED.has(row.status)) orders.delete(id);
        else orders.set(id, row);
      }
      return { ...state, orders, seen: new Set([...state.seen, "orders"]) };
    }
    case "ACCOUNT.BALANCE":
      return { ...state, balance: (data.balance as ExtendedBalance) ?? state.balance, seen: new Set([...state.seen, "balance"]) };
    default:
      return state;
  }
}
