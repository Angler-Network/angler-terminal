"use client";

import { sideLabel } from "@/lib/trading/presets";
import type { TradeTicket } from "./trade-ticket";
import { useTradeTicket } from "./trade-ticket";

/** Shows an armed news trade in the order panel until it is confirmed or canceled. */
export function TicketBanner({ ticket }: { ticket: TradeTicket }) {
  const { cancel } = useTradeTicket();
  const confirmed = ticket.confirmNonce > 0;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-app-hairline-strong bg-app-chip/70 px-2.5 py-2 text-[12px]">
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-app-ink">
          {confirmed ? "Placing" : "From news:"} {sideLabel(ticket.venue, ticket.side)} {ticket.symbol} · ${ticket.sizeUsd}
        </p>
        {!confirmed && (
          <p className="mt-0.5 text-app-muted">
            Click again or press {ticket.side === "buy" ? "L" : "S"} to confirm. 1/2/3 change size. Esc cancels.
          </p>
        )}
      </div>
      {!confirmed && (
        <button type="button" onClick={cancel} className="font-semibold text-app-muted hover:text-app-ink">
          Cancel
        </button>
      )}
    </div>
  );
}
