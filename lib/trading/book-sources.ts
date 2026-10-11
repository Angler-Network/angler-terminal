/** How many venues the merged order book streams at most (one socket or poller each). */
export const MAX_BOOK_SOURCES = 4;
/** How many the default "All venues" view merges, in the venue order. */
export const DEFAULT_BOOK_SOURCES = 3;

/**
 * The venues the order book shows, in the listed order: the picked ones that list the asset, else (nothing picked, or
 * none of the picked list it) the first `DEFAULT_BOOK_SOURCES`.
 */
export function bookSources<V>(listed: V[], picked: V[] | null): V[] {
  const chosen = picked ? listed.filter((venue) => picked.includes(venue)).slice(0, MAX_BOOK_SOURCES) : [];
  return chosen.length > 0 ? chosen : listed.slice(0, DEFAULT_BOOK_SOURCES);
}

/** Adds or removes one venue from the shown ones; the last one stays, and no more than `MAX_BOOK_SOURCES` join. */
export function toggleBookSource<V>(shown: V[], venue: V): V[] {
  if (shown.includes(venue)) return shown.length > 1 ? shown.filter((entry) => entry !== venue) : shown;
  return shown.length >= MAX_BOOK_SOURCES ? shown : [...shown, venue];
}
