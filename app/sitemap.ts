import type { MetadataRoute } from "next";
import { isIndexable, siteUrl } from "@/lib/site";

/** The public pages of this site; profiles are per wallet and prediction isn't live, so they aren't listed. */
export default function sitemap(): MetadataRoute.Sitemap {
  if (!isIndexable()) return [];
  return [
    { url: `${siteUrl()}/perp`, changeFrequency: "daily", priority: 1 },
    { url: `${siteUrl()}/spot`, changeFrequency: "daily", priority: 0.9 },
    { url: `${siteUrl()}/markets`, changeFrequency: "daily", priority: 0.8 },
    { url: `${siteUrl()}/profile/leaderboard`, changeFrequency: "hourly", priority: 0.5 },
  ];
}
