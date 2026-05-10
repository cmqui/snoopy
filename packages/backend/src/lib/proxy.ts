import type { DeliveryPath, EventDisposition } from "../types.js";

export function classifyDeliveryPath(userAgent: string, ip: string): DeliveryPath {
  const ua = userAgent.toLowerCase();
  const normalizedIp = ip.trim();

  if (ua.includes("googleimageproxy") || ua.includes("google image proxy")) {
    return "gmail_proxy";
  }

  if (normalizedIp.startsWith("66.249.") || normalizedIp.startsWith("209.85.") || normalizedIp.startsWith("64.233.")) {
    return "gmail_proxy";
  }

  if (isAppleMailPrivacyUserAgent(ua)) {
    return "apple_mail_privacy";
  }

  if (isSecurityScannerUserAgent(ua)) {
    return "security_scanner";
  }

  if (isPrivacyProxyUserAgent(ua)) {
    return "privacy_proxy";
  }

  if (isLikelyDirectUserAgent(ua)) {
    return "direct";
  }

  return "unknown";
}

export function buildDedupeKey(input: {
  tokenId: string;
  ip: string;
  userAgent: string;
  occurredAt: Date;
  deliveryPath: DeliveryPath;
  disposition: EventDisposition;
}): string {
  const bucketMs = input.deliveryPath === "direct" ? 60 * 1000 : 15 * 60 * 1000;
  const timeBucket = Math.floor(input.occurredAt.getTime() / bucketMs);
  const pathKey = input.deliveryPath;

  if (pathKey !== "direct") {
    return `${input.tokenId}:${pathKey}:${input.disposition}:${timeBucket}`;
  }

  const normalizedIp = input.ip.trim();
  const normalizedUa = normalizeUserAgent(input.userAgent);
  return `${input.tokenId}:${normalizedIp}:${normalizedUa}:${timeBucket}`;
}

function normalizeUserAgent(userAgent: string): string {
  return userAgent.trim().toLowerCase().replace(/\s+/g, " ");
}

function isAppleMailPrivacyUserAgent(ua: string): boolean {
  return ua.includes("mailprivacyprotection") ||
    ua.includes("mail privacy protection") ||
    (ua.includes("applemail") && ua.includes("mail") && ua.includes("privacy")) ||
    (ua.includes("cfnetwork") && ua.includes("darwin") && ua.includes("mail"));
}

function isSecurityScannerUserAgent(ua: string): boolean {
  const scannerMarkers = [
    "barracuda",
    "mimecast",
    "proofpoint",
    "safelinks",
    "defender",
    "microsoft office existence discovery",
    "urlscan",
    "virus",
    "scanner",
    "spambayes",
    "spamassassin",
    "symantec",
  ];

  return scannerMarkers.some((marker) => ua.includes(marker));
}

function isPrivacyProxyUserAgent(ua: string): boolean {
  const proxyMarkers = [
    "proxy",
    "prefetch",
    "preview",
    "bot",
    "crawler",
    "spider",
    "headless",
  ];

  return proxyMarkers.some((marker) => ua.includes(marker));
}

function isLikelyDirectUserAgent(ua: string): boolean {
  if (!ua || ua === "unknown") {
    return false;
  }

  const normalizedUa = normalizeUserAgent(ua);
  return normalizedUa.includes("mozilla/") ||
    normalizedUa.includes("applewebkit/") ||
    normalizedUa.includes("chrome/") ||
    normalizedUa.includes("safari/") ||
    normalizedUa.includes("firefox/") ||
    normalizedUa.includes("outlook") ||
    normalizedUa.includes("thunderbird");
}
