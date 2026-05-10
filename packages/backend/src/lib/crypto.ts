import crypto from "node:crypto";

export function createId(): string {
  return crypto.randomUUID();
}

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function hmacSha256(input: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(input).digest("base64url");
}
