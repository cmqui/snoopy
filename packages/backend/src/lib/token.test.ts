import { describe, expect, it } from "vitest";
import type { PixelTokenPayload } from "../types.js";
import { signPixelToken, verifyPixelToken } from "./token.js";

describe("pixel token signing", () => {
  it("round-trips a valid payload", () => {
    const payload: PixelTokenPayload = {
      trackedMessageId: "message-1",
      trackedRecipientId: "recipient-1",
      ownerUserId: "user-1",
      tokenId: "token-1",
      issuedAt: "2026-05-10T00:00:00.000Z",
      version: 1,
    };

    const signed = signPixelToken(payload, "x".repeat(32));
    expect(verifyPixelToken(signed, "x".repeat(32))).toEqual(payload);
  });

  it("rejects tampered tokens", () => {
    const payload: PixelTokenPayload = {
      trackedMessageId: "message-1",
      trackedRecipientId: "recipient-1",
      ownerUserId: "user-1",
      tokenId: "token-1",
      issuedAt: "2026-05-10T00:00:00.000Z",
      version: 1,
    };

    const signed = signPixelToken(payload, "x".repeat(32));
    expect(verifyPixelToken(`${signed}tamper`, "x".repeat(32))).toBeNull();
  });
});
