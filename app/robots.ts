import type { MetadataRoute } from "next";
import { isIndexable, siteUrl } from "@/lib/site";

/** Crawlers see each site's pages (not its API); dev builds are closed to them. */
export default function robots(): MetadataRoute.Robots {
  if (!isIndexable()) return { rules: { userAgent: "*", disallow: "/" } };
  return { rules: { userAgent: "*", allow: "/", disallow: "/api/" }, sitemap: `${siteUrl()}/sitemap.xml`, host: siteUrl() };
}
