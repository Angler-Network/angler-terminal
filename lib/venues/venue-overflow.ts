/**
 * Which of a row's venues show as logos and which fold into a "+N" chip. Up to `slots` venues all show (the chip would
 * take a logo's place anyway); past that, the first `slots - 1` show and the rest fold. Order is kept as given, so every
 * row lists its venues in the same order and a column of logos stays scannable.
 */
export function splitVenues<T>(venues: T[], slots = 4): { shown: T[]; hidden: T[] } {
  if (venues.length <= slots) return { shown: venues, hidden: [] };
  const keep = Math.max(1, slots - 1);
  return { shown: venues.slice(0, keep), hidden: venues.slice(keep) };
}
