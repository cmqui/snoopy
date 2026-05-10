import type { DeliveryPath } from "../types.js";

export function classifyDeliveryPath(userAgent: string, ip: string): DeliveryPath {
  const ua = userAgent.toLowerCase();
  if (ua.includes("googleimageproxy") || ua.includes("google image proxy")) {
    return "gmail_proxy";
  }

  if (ip.startsWith("66.249.") || ip.startsWith("209.85.") || ip.startsWith("64.233.")) {
    return "gmail_proxy";
  }

  return "unknown";
}

export function buildDedupeKey(tokenId: string, ip: string, userAgent: string, occurredAt: Date): string {
  const minuteBucket = occurredAt.toISOString().slice(0, 16);
  const normalizedUa = userAgent.trim().toLowerCase().replace(/\s+/g, " ");
  const normalizedIp = ip.trim();
  return `${tokenId}:${normalizedIp}:${normalizedUa}:${minuteBucket}`;
}
