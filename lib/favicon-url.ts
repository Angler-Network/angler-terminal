/**
 * Logos we host ourselves where a site's favicon reads badly, at their own path (a fixed favicon URL would keep showing
 * the old icon from browser and CDN caches): Extended's favicon is a green mark on an opaque white square, so its own
 * transparent SVG (from extended.exchange) stands in.
 */
export const LOCAL_ICONS: Record<string, string> = { "extended.exchange": "/venues/extended.svg" };

/** A site's logo: our own copy when we host one, else its favicon through our proxy. */
export function faviconUrl(domain: string) {
  return LOCAL_ICONS[domain] ?? `/api/favicon?domain=${encodeURIComponent(domain)}`;
}
