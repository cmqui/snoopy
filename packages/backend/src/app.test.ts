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

function createClock(initial: string) {
  let current = new Date(initial);

  return {
    now: () => new Date(current.getTime()),
    advanceMs(ms: number) {
      current = new Date(current.getTime() + ms);
    },
  };
}

function createTestServer(input: { now?: () => Date } = {}) {
  const repository = new InMemoryTrackingRepository();
  const notifier = new SpyNotificationService();
  const trackerService = new TrackerService(
    repository,
    notifier,
    "x".repeat(32),
    "http://localhost:8080",
    input.now,
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

function extractToken(instrumentedHtmlBody: string): string {
  const tokenMatch = instrumentedHtmlBody.match(/\/t\/([^"]+)\.gif/);
  expect(tokenMatch?.[1]).toBeTruthy();
  return decodeURIComponent(tokenMatch?.[1] ?? "");
}

describe("backend app", () => {
  it("prepares, marks sent, records opens, and exposes details", async () => {
    const clock = createClock("2026-05-10T00:00:00.000Z");
    const { app, notifier } = createTestServer({ now: clock.now });

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
    const token = extractToken(prepareResponse.body.instrumentedHtmlBody as string);

    clock.advanceMs(1000);
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
    expect(markSentResponse.body.confidencePercent).toBe(0);

    const ignoredResponse = await request(app)
      .get(`/t/${token}.gif`)
      .set("user-agent", "GoogleImageProxy")
      .set("x-forwarded-for", "66.249.84.1");

    expect(ignoredResponse.status).toBe(200);
    expect(ignoredResponse.header["content-type"]).toContain("image/gif");

    const duplicateResponse = await request(app)
      .get(`/t/${token}.gif`)
      .set("user-agent", "GoogleImageProxy")
      .set("x-forwarded-for", "66.249.84.1");

    expect(duplicateResponse.status).toBe(200);

    clock.advanceMs(11_000);
    const probableResponse = await request(app)
      .get(`/t/${token}.gif`)
      .set("user-agent", "GoogleImageProxy")
      .set("x-forwarded-for", "66.249.84.2");

    expect(probableResponse.status).toBe(200);

    const countedResponse = await request(app)
      .get(`/t/${token}.gif`)
      .set("user-agent", "Mozilla/5.0")
      .set("x-forwarded-for", "203.0.113.10");

    expect(countedResponse.status).toBe(200);

    const detailResponse = await request(app)
      .get(`/api/v1/messages/${trackedMessageId}`)
      .set("x-test-user-email", "allowed@example.com");

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.message.status).toBe("fully_opened");
    expect(detailResponse.body.recipients[0].openCount).toBe(2);
    expect(detailResponse.body.recipients[0].lastOpenIp).toBe("203.0.113.10");
    expect(detailResponse.body.recipients[0].confidencePercent).toBe(95);
    expect(detailResponse.body.confidencePercent).toBe(95);
    expect(detailResponse.body.recipients[0].events).toHaveLength(3);
    expect(detailResponse.body.recipients[0].events[0].disposition).toBe("ignored_sender_or_prefetch");
    expect(detailResponse.body.recipients[0].events[1].disposition).toBe("probable_open");
    expect(detailResponse.body.recipients[0].events[2].disposition).toBe("counted");
    expect(notifier.calls).toHaveLength(1);
  });

  it("rejects non-allowlisted users", async () => {
    const { app } = createTestServer();

    const response = await request(app)
      .get("/api/v1/messages")
      .set("x-test-user-email", "blocked@example.com");

    expect(response.status).toBe(403);
  });

  it("looks up tracked messages by gmail thread id", async () => {
    const { app } = createTestServer();

    const prepareResponse = await request(app)
      .post("/api/v1/messages/prepare")
      .set("x-test-user-email", "allowed@example.com")
      .send({
        subject: "Thread lookup",
        htmlBody: "<p>Thread lookup</p>",
        recipients: [
          { email: "recipient@example.com", recipientType: "to" },
        ],
        draftContextType: "reply",
        gmailThreadId: "thread-123",
      });

    const trackedMessageId = prepareResponse.body.trackedMessageId as string;

    await request(app)
      .post("/api/v1/messages/mark-sent")
      .set("x-test-user-email", "allowed@example.com")
      .send({
        trackedMessageId,
        gmailMessageId: "gmail-message-3",
        gmailThreadId: "thread-123",
        recipients: [
          { email: "recipient@example.com", recipientType: "to" },
        ],
      });

    const threadResponse = await request(app)
      .get("/api/v1/threads/thread-123/message")
      .set("x-test-user-email", "allowed@example.com");

    expect(threadResponse.status).toBe(200);
    expect(threadResponse.body.message.message.id).toBe(trackedMessageId);
    expect(threadResponse.body.message.message.gmailThreadId).toBe("thread-123");
  });

  it("keeps privacy proxy activity unconfirmed", async () => {
    const clock = createClock("2026-05-10T00:00:00.000Z");
    const { app, notifier } = createTestServer({ now: clock.now });

    const prepareResponse = await request(app)
      .post("/api/v1/messages/prepare")
      .set("x-test-user-email", "allowed@example.com")
      .send({
        subject: "Privacy proxy",
        htmlBody: "<p>Privacy proxy</p>",
        recipients: [
          { email: "recipient@example.com", recipientType: "to" },
        ],
        draftContextType: "new",
      });

    const trackedMessageId = prepareResponse.body.trackedMessageId as string;
    const token = extractToken(prepareResponse.body.instrumentedHtmlBody as string);

    await request(app)
      .post("/api/v1/messages/mark-sent")
      .set("x-test-user-email", "allowed@example.com")
      .send({
        trackedMessageId,
        gmailMessageId: "gmail-message-2",
        recipients: [
          { email: "recipient@example.com", recipientType: "to" },
        ],
      });

    clock.advanceMs(11_000);
    await request(app)
      .get(`/t/${token}.gif`)
      .set("user-agent", "Mozilla/5.0 AppleMail MailPrivacyProtection")
      .set("x-forwarded-for", "203.0.113.20");

    clock.advanceMs(15 * 60 * 1000);
    await request(app)
      .get(`/t/${token}.gif`)
      .set("user-agent", "Mozilla/5.0 AppleMail MailPrivacyProtection")
      .set("x-forwarded-for", "203.0.113.21");

    const detailResponse = await request(app)
      .get(`/api/v1/messages/${trackedMessageId}`)
      .set("x-test-user-email", "allowed@example.com");

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.message.status).toBe("sent");
    expect(detailResponse.body.recipients[0].openCount).toBe(0);
    expect(detailResponse.body.recipients[0].confidencePercent).toBe(30);
    expect(detailResponse.body.confidencePercent).toBe(30);
    expect(detailResponse.body.recipients[0].events).toHaveLength(2);
    expect(detailResponse.body.recipients[0].events[0].disposition).toBe("unconfirmed_privacy_proxy_activity");
    expect(notifier.calls).toHaveLength(0);
  });

  it("suppresses gmail proxy activity around an owner self-view", async () => {
    const clock = createClock("2026-05-10T00:00:00.000Z");
    const { app } = createTestServer({ now: clock.now });

    const prepareResponse = await request(app)
      .post("/api/v1/messages/prepare")
      .set("x-test-user-email", "allowed@example.com")
      .send({
        subject: "Self view",
        htmlBody: "<p>Self view</p>",
        recipients: [
          { email: "recipient@example.com", recipientType: "to" },
        ],
        draftContextType: "new",
      });

    const trackedMessageId = prepareResponse.body.trackedMessageId as string;
    const token = extractToken(prepareResponse.body.instrumentedHtmlBody as string);

    await request(app)
      .post("/api/v1/messages/mark-sent")
      .set("x-test-user-email", "allowed@example.com")
      .send({
        trackedMessageId,
        gmailMessageId: "gmail-message-self-view",
        gmailThreadId: "thread-self-view",
        recipients: [
          { email: "recipient@example.com", recipientType: "to" },
        ],
      });

    clock.advanceMs(11_000);
    await request(app)
      .get(`/t/${token}.gif`)
      .set("user-agent", "GoogleImageProxy")
      .set("x-forwarded-for", "66.249.84.10");

    clock.advanceMs(5_000);
    const selfViewResponse = await request(app)
      .post("/api/v1/messages/self-view")
      .set("x-test-user-email", "allowed@example.com")
      .send({
        trackedMessageId,
        gmailMessageId: "gmail-message-self-view",
        gmailThreadId: "thread-self-view",
        viewedAt: clock.now().toISOString(),
        platform: "WEB",
      });

    expect(selfViewResponse.status).toBe(200);
    expect(selfViewResponse.body.status).toBe("sent");
    expect(selfViewResponse.body.openedRecipientCount).toBe(0);

    clock.advanceMs(20_000);
    await request(app)
      .get(`/t/${token}.gif`)
      .set("user-agent", "GoogleImageProxy")
      .set("x-forwarded-for", "66.249.84.11");

    clock.advanceMs(30_000);
    await request(app)
      .get(`/t/${token}.gif`)
      .set("user-agent", "GoogleImageProxy")
      .set("x-forwarded-for", "66.249.84.12");

    const detailResponse = await request(app)
      .get(`/api/v1/messages/${trackedMessageId}`)
      .set("x-test-user-email", "allowed@example.com");

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.message.lastSelfViewedAt).toBe("2026-05-10T00:00:16.000Z");
    expect(detailResponse.body.message.lastSelfViewPlatform).toBe("WEB");
    expect(detailResponse.body.message.status).toBe("fully_opened");
    expect(detailResponse.body.recipients[0].openCount).toBe(1);
    expect(detailResponse.body.recipients[0].events).toHaveLength(3);
    expect(detailResponse.body.recipients[0].events[0].disposition).toBe("ignored_sender_or_prefetch");
    expect(detailResponse.body.recipients[0].events[1].disposition).toBe("ignored_sender_or_prefetch");
    expect(detailResponse.body.recipients[0].events[2].disposition).toBe("probable_open");
  });

  it("ignores immediate draft fetches when a send has not been confirmed", async () => {
    const clock = createClock("2026-05-10T00:00:00.000Z");
    const { app } = createTestServer({ now: clock.now });

    const prepareResponse = await request(app)
      .post("/api/v1/messages/prepare")
      .set("x-test-user-email", "allowed@example.com")
      .send({
        subject: "Draft grace",
        htmlBody: "<p>Draft grace</p>",
        recipients: [
          { email: "recipient@example.com", recipientType: "to" },
        ],
        draftContextType: "new",
      });

    const trackedMessageId = prepareResponse.body.trackedMessageId as string;
    const token = extractToken(prepareResponse.body.instrumentedHtmlBody as string);

    await request(app)
      .get(`/t/${token}.gif`)
      .set("user-agent", "GoogleImageProxy")
      .set("x-forwarded-for", "66.249.84.1");

    clock.advanceMs(2 * 60 * 1000 + 1000);
    await request(app)
      .get(`/t/${token}.gif`)
      .set("user-agent", "GoogleImageProxy")
      .set("x-forwarded-for", "66.249.84.2");

    const detailResponse = await request(app)
      .get(`/api/v1/messages/${trackedMessageId}`)
      .set("x-test-user-email", "allowed@example.com");

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.message.sentAt).toBeNull();
    expect(detailResponse.body.message.status).toBe("fully_opened");
    expect(detailResponse.body.recipients[0].openCount).toBe(1);
    expect(detailResponse.body.recipients[0].events[0].disposition).toBe("ignored_sender_or_prefetch");
    expect(detailResponse.body.recipients[0].events[1].disposition).toBe("probable_open");

    const markSentResponse = await request(app)
      .post("/api/v1/messages/mark-sent")
      .set("x-test-user-email", "allowed@example.com")
      .send({
        trackedMessageId,
        gmailMessageId: "gmail-message-after-open",
        sentAt: "2026-05-10T00:01:00.000Z",
        recipients: [
          { email: "recipient@example.com", recipientType: "to" },
        ],
      });

    expect(markSentResponse.status).toBe(200);
    expect(markSentResponse.body.status).toBe("fully_opened");
  });

  it("rejects multi-recipient tracking", async () => {
    const { app } = createTestServer();

    const response = await request(app)
      .post("/api/v1/messages/prepare")
      .set("x-test-user-email", "allowed@example.com")
      .send({
        subject: "Too many",
        htmlBody: "<p>Too many</p>",
        recipients: [
          { email: "one@example.com", recipientType: "to" },
          { email: "two@example.com", recipientType: "cc" },
        ],
        draftContextType: "new",
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("exactly one");
  });

  it("rejects recipient changes after tracking is applied", async () => {
    const { app } = createTestServer();

    const prepareResponse = await request(app)
      .post("/api/v1/messages/prepare")
      .set("x-test-user-email", "allowed@example.com")
      .send({
        subject: "Recipient change",
        htmlBody: "<p>Recipient change</p>",
        recipients: [
          { email: "original@example.com", recipientType: "to" },
        ],
        draftContextType: "new",
      });

    const response = await request(app)
      .post("/api/v1/messages/mark-sent")
      .set("x-test-user-email", "allowed@example.com")
      .send({
        trackedMessageId: prepareResponse.body.trackedMessageId,
        gmailMessageId: "gmail-message-4",
        recipients: [
          { email: "changed@example.com", recipientType: "to" },
        ],
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("cannot be changed");
  });
});
