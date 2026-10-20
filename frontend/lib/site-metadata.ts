const RESERVED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".example", ".test", ".invalid"];

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  const [first, second] = octets;
  return first === 0 || first === 10 || first === 127 || first === 192 && second === 168 ||
    first === 172 && second >= 16 && second <= 31 || first === 169 && second === 254 ||
    first === 100 && second >= 64 && second <= 127;
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  return host === "localhost" || host === "example.com" || host.endsWith(".example.com") ||
    RESERVED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix)) || isPrivateIpv4(host) ||
    host === "::1" || host.includes(":") && (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:"));
}

export function parseSiteUrl(value: string | undefined): URL | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

export function isPublicSiteUrl(url: URL, isProduction = process.env.NODE_ENV === "production"): boolean {
  if (isPrivateHost(url.hostname)) return false;
  return !isProduction || url.protocol === "https:";
}

export function getSiteMetadataConfig() {
  const configuredUrl = parseSiteUrl(process.env.SITE_URL);
  const isProduction = process.env.NODE_ENV === "production";
  const publicUrl = configuredUrl && isPublicSiteUrl(configuredUrl, isProduction) ? new URL(configuredUrl.origin) : null;
  const developmentUrl = configuredUrl ?? new URL("http://localhost:3000");

  return {
    metadataBase: publicUrl ?? (!isProduction ? developmentUrl : undefined),
    publicUrl,
    indexable: Boolean(publicUrl),
  };
}

export function escapeJsonForHtml(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
