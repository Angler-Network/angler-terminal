"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

/**
 * Lets the order book hand a clicked price to the order panel (as its limit price), and the order panel ask the book to
 * show the venue picked there by hand.
 */
interface OrderDraftValue {
  /** Bumps on every click so the same price clicked twice still applies. */
  pickedPrice: { price: number; at: number } | null;
  pickPrice: (price: number) => void;
  /** The venue last picked by hand in the order panel; `at` bumps so picking it again after "All venues" applies. */
  bookVenue: { venue: string; at: number } | null;
  showBookVenue: (venue: string) => void;
}

const OrderDraftContext = createContext<OrderDraftValue>({ pickedPrice: null, pickPrice: () => {}, bookVenue: null, showBookVenue: () => {} });

export function useOrderDraft() {
  return useContext(OrderDraftContext);
}

export function OrderDraftProvider({ children }: { children: React.ReactNode }) {
  const [pickedPrice, setPickedPrice] = useState<OrderDraftValue["pickedPrice"]>(null);
  const [bookVenue, setBookVenue] = useState<OrderDraftValue["bookVenue"]>(null);
  const pickPrice = useCallback((price: number) => setPickedPrice({ price, at: Date.now() }), []);
  const showBookVenue = useCallback((venue: string) => setBookVenue({ venue, at: Date.now() }), []);
  const value = useMemo(() => ({ pickedPrice, pickPrice, bookVenue, showBookVenue }), [pickedPrice, pickPrice, bookVenue, showBookVenue]);
  return <OrderDraftContext.Provider value={value}>{children}</OrderDraftContext.Provider>;
}
