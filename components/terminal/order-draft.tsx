"use client";

import { createContext, useContext, useMemo, useState } from "react";

/** Lets the order book hand a clicked price to the order panel (as its limit price). */
interface OrderDraftValue {
  /** Bumps on every click so the same price clicked twice still applies. */
  pickedPrice: { price: number; at: number } | null;
  pickPrice: (price: number) => void;
}

const OrderDraftContext = createContext<OrderDraftValue>({ pickedPrice: null, pickPrice: () => {} });

export function useOrderDraft() {
  return useContext(OrderDraftContext);
}

export function OrderDraftProvider({ children }: { children: React.ReactNode }) {
  const [pickedPrice, setPickedPrice] = useState<OrderDraftValue["pickedPrice"]>(null);
  const value = useMemo(() => ({ pickedPrice, pickPrice: (price: number) => setPickedPrice({ price, at: Date.now() }) }), [pickedPrice]);
  return <OrderDraftContext.Provider value={value}>{children}</OrderDraftContext.Provider>;
}
