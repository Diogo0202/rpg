import type { MetadataRoute } from "next";
import { getSiteMetadataConfig } from "../lib/site-metadata";

export default function sitemap(): MetadataRoute.Sitemap {
  const site = getSiteMetadataConfig();
  if (!site.indexable) return [];
  return [
    { url: site.publicUrl!.toString() },
    { url: new URL("/marketplace", site.publicUrl!).toString() },
  ];
}
