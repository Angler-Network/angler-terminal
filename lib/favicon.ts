/**
 * Favicons for news sources, fetched server-side so the browser never calls third-party icon services directly.
 * Tries DuckDuckGo's icon service, then Google's; both resolve the site's real favicon by domain.
 */

const DOMAIN_PATTERN = /^(?=.{3,253}$)(?!-)[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+$/;
const MAX_BYTES = 200_000;
const TIMEOUT_MS = 5_000;

export function normalizeDomain(value: string | null | undefined) {
  const domain = value?.trim().toLowerCase().replace(/^www\./, "");
  return domain && DOMAIN_PATTERN.test(domain) && !/^\d+(\.\d+)+$/.test(domain) ? domain : null;
}

export function faviconSources(domain: string) {
  return [`https://icons.duckduckgo.com/ip3/${domain}.ico`, `https://www.google.com/s2/favicons?domain=${domain}&sz=64`];
}

export interface Favicon {
  body: ArrayBuffer;
  contentType: string;
}

/** Returns the first real image from the sources, or null. Rejects non-images, empty and oversized bodies. */
export async function fetchFavicon(domain: string, fetchImpl: typeof fetch = fetch): Promise<Favicon | null> {
  for (const url of faviconSources(domain)) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "follow" });
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || !/^image\//.test(contentType)) continue;
      const body = await response.arrayBuffer();
      if (body.byteLength === 0 || body.byteLength > MAX_BYTES) continue;
      return { body, contentType };
    } catch {}
  }
  return null;
}
