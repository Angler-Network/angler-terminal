/**
 * Extended's restricted jurisdictions (docs.extended.exchange/extended-resources/legal/restricted-countries.md), as ISO
 * 3166 codes for Vercel's `x-vercel-ip-country` / `x-vercel-ip-country-region` headers. Our proxy relays orders from its
 * own IP, so it applies Extended's list itself: a restricted visitor is refused here exactly as Extended would refuse
 * them directly. Never relax this to reach more users.
 */

export const EXTENDED_RESTRICTED_COUNTRIES = new Set(["AF", "CA", "HK", "CU", "IR", "KP", "RU", "SY", "SC", "GB", "US"]);

/** Occupied Ukrainian regions (ISO 3166-2:UA): Crimea, Sevastopol, Donetsk, Luhansk, Kherson, Zaporizhzhia. */
export const EXTENDED_RESTRICTED_UA_REGIONS = new Set(["43", "40", "14", "09", "65", "23"]);

/** Whether a visitor from this country (and region) may not use Extended. An unknown country counts as restricted. */
export function extendedRestricted(country: string | null | undefined, region?: string | null) {
  const code = country?.trim().toUpperCase();
  if (!code || code.length !== 2) return true;
  if (EXTENDED_RESTRICTED_COUNTRIES.has(code)) return true;
  return code === "UA" && Boolean(region && EXTENDED_RESTRICTED_UA_REGIONS.has(region.trim().toUpperCase()));
}
