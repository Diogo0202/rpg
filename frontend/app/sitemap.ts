import type { MetadataRoute } from "next";

// Nunca anunciamos uma URL inventada: o deploy define SITE_URL antes de indexar.
export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = process.env.SITE_URL;
  if (!siteUrl) return [];
  return [{ url: new URL("/", siteUrl).toString(), lastModified: new Date() }];
}
