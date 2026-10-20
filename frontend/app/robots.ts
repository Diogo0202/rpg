import type { MetadataRoute } from "next";
import { getSiteMetadataConfig } from "../lib/site-metadata";

export default function robots(): MetadataRoute.Robots {
  const site = getSiteMetadataConfig();
  return {
    rules: {
      userAgent: "*",
      allow: site.indexable ? "/" : undefined,
      disallow: site.indexable ? ["/app", "/login", "/auth"] : "/",
    },
    ...(site.indexable ? { sitemap: new URL("/sitemap.xml", site.publicUrl!).toString() } : {}),
  };
}
