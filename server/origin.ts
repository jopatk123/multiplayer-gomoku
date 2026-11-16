import type { GomokuConfig } from "./config.ts";

function isLocalHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]" || hostname === "::1";
}

export function isLocalOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") && isLocalHostname(url.hostname);
  } catch {
    return false;
  }
}

function hostMatchesSuffix(hostname: string, suffix: string): boolean {
  const normalized = suffix.startsWith(".") ? suffix.toLowerCase() : `.${suffix.toLowerCase()}`;
  const host = hostname.toLowerCase();
  return host === normalized.slice(1) || host.endsWith(normalized);
}

export function originAllowed(origin: string | undefined, cfg: GomokuConfig): boolean {
  if (!origin) return cfg.allowNoOrigin;
  if (cfg.allowedOrigins.includes(origin)) return true;
  if (cfg.allowLocalOrigins && isLocalOrigin(origin)) return true;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" && !(cfg.allowLocalOrigins && isLocalOrigin(origin))) {
      return false;
    }
    return cfg.allowedOriginHostSuffixes.some((suffix) => hostMatchesSuffix(url.hostname, suffix));
  } catch {
    return false;
  }
}
