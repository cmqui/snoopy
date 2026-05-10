import type express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { InMemoryTrackingRepository } from "./repositories/memory.js";
import type { MessageRecipientDetailResponse, TrackedMessage, UserRecord } from "./types.js";
import type { NotificationService } from "./services/notifier.js";
import { TrackerService } from "./services/tracker.js";

class SpyNotificationService implements NotificationService {
  public calls: Array<{
    owner: UserRecord;
    message: TrackedMessage;
    recipient: MessageRecipientDetailResponse;
  }> = [];

  public async sendFirstOpenNotification(input: {
    owner: UserRecord;
    message: TrackedMessage;
    recipient: MessageRecipientDetailResponse;
  }): Promise<void> {
    this.calls.push(input);
  }
}

function createTestServer() {
  const repository = new InMemoryTrackingRepository();
  const notifier = new SpyNotificationService();
  const trackerService = new TrackerService(
    repository,
    notifier,
    "x".repeat(32),
    "http://localhost:8080",
  );

  const authMiddleware: express.RequestHandler = (req, _res, next) => {
    req.auth = {
      user: {
        id: req.header("x-test-user-id") ?? "user-1",
        email: req.header("x-test-user-email") ?? "allowed@example.com",
        displayName: "Allowed User",
      },
    };
    next();
  };

  const app = createApp({
    authMiddleware,
    trackerService,
    tokenSigningSecret: "x".repeat(32),
    allowedUserEmails: new Set(["allowed@example.com"]),
  });

  return { app, repository, notifier };
}

describe("backend app", () => {
  it("prepares, marks sent, records opens, and exposes details", async () => {
    const { app, notifier } = createTestServer();

    const prepareResponse = await request(app)
      .post("/api/v1/messages/prepare")
      .set("x-test-user-email", "allowed@example.com")
      .send({
        subject: "Hello",
        htmlBody: "<p>Hello world</p>",
        recipients: [
          { email: "recipient@example.com", recipientType: "to" },
        ],
        draftContextType: "new",
      });

    expect(prepareResponse.status).toBe(200);
    expect(prepareResponse.body.trackedMessageId).toBeTruthy();
    const trackedMessageId = prepareResponse.body.trackedMessageId as string;
    const instrumentedHtmlBody = prepareResponse.body.instrumentedHtmlBody as string;
    const tokenMatch = instrumentedHtmlBody.match(/\/t\/([^"]+)\.gif/);
    expect(tokenMatch?.[1]).toBeTruthy();
    const token = decodeURIComponent(tokenMatch?.[1] ?? "");

    const markSentResponse = await request(app)
      .post("/api/v1/messages/mark-sent")
      .set("x-test-user-email", "allowed@example.com")
      .send({
        trackedMessageId,
        gmailMessageId: "gmail-message-1",
        recipients: [
          { email: "recipient@example.com", recipientType: "to" },
        ],
      });

    expect(markSentResponse.status).toBe(200);
    expect(markSentResponse.body.status).toBe("sent");

    const openResponse = await request(app)
      .get(`/t/${token}.gif`)
      .set("user-agent", "GoogleImageProxy")
      .set("x-forwarded-for", "66.249.84.1");

    expect(openResponse.status).toBe(200);
    expect(openResponse.header["content-type"]).toContain("image/gif");

    const duplicateResponse = await request(app)
      .get(`/t/${token}.gif`)
      .set("user-agent", "GoogleImageProxy")
      .set("x-forwarded-for", "66.249.84.1");

    expect(duplicateResponse.status).toBe(200);

    const detailResponse = await request(app)
      .get(`/api/v1/messages/${trackedMessageId}`)
      .set("x-test-user-email", "allowed@example.com");

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.message.status).toBe("fully_opened");
    expect(detailResponse.body.recipients[0].openCount).toBe(1);
    expect(detailResponse.body.recipients[0].lastOpenIp).toBe("66.249.84.1");
    expect(detailResponse.body.recipients[0].events[0].deliveryPath).toBe("gmail_proxy");
    expect(notifier.calls).toHaveLength(1);
  });

  it("rejects non-allowlisted users", async () => {
    const { app } = createTestServer();

    const response = await request(app)
      .get("/api/v1/messages")
      .set("x-test-user-email", "blocked@example.com");

    expect(response.status).toBe(403);
  });
});
