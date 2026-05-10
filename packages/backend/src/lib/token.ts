import { hmacSha256 } from "./crypto.js";
import type { PixelTokenPayload } from "../types.js";

interface SignedTokenEnvelope {
  payload: PixelTokenPayload;
  signature: string;
}

export function signPixelToken(payload: PixelTokenPayload, secret: string): string {
  const payloadSegment = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = hmacSha256(payloadSegment, secret);

  return `${payloadSegment}.${signature}`;
}

export function verifyPixelToken(token: string, secret: string): PixelTokenPayload | null {
  const [payloadSegment, providedSignature] = token.split(".");
  if (!payloadSegment || !providedSignature) {
    return null;
  }

  const expectedSignature = hmacSha256(payloadSegment, secret);
  if (expectedSignature !== providedSignature) {
    return null;
  }

  try {
    const envelope: SignedTokenEnvelope = {
      payload: JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8")) as PixelTokenPayload,
      signature: providedSignature,
    };

    return envelope.payload;
  } catch {
    return null;
  }
}
