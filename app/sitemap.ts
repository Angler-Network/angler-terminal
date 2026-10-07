import type { MetadataRoute } from "next";
import { isIndexable, siteUrl } from "@/lib/site";

/** The public pages of this site; the portfolio is per wallet, so it isn't listed. */
export default function sitemap(): MetadataRoute.Sitemap {
  if (!isIndexable()) return [];
  return [
    { url: `${siteUrl()}/`, changeFrequency: "daily", priority: 1 },
    { url: `${siteUrl()}/markets`, changeFrequency: "daily", priority: 0.8 },
  ];
}
