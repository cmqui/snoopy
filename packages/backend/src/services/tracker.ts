import { HttpError } from "../errors.js";
import { createId, sha256 } from "../lib/crypto.js";
import { instrumentHtmlBody } from "../lib/html.js";
import { buildDedupeKey, classifyDeliveryPath } from "../lib/proxy.js";
import type { TrackingRepository } from "../repositories/types.js";
import type {
  AuthenticatedUser,
  DeliveryPath,
  EventDisposition,
  MarkSentRequest,
  MessageDetailResponse,
  MessageRecipientDetailResponse,
  MessageSummaryResponse,
  OpenEvent,
  PixelTokenPayload,
  PrepareTrackedMessageRequest,
  PrepareTrackedMessageResponse,
  RecipientInput,
  ThreadLookupResponse,
  TrackedMessage,
  TrackedRecipient,
  UserRecord,
} from "../types.js";
import type { NotificationService } from "./notifier.js";

export class TrackerService {
  public constructor(
    private readonly repository: TrackingRepository,
    private readonly notificationService: NotificationService,
    private readonly tokenSecret: string,
    private readonly appBaseUrl: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async syncUser(user: AuthenticatedUser, allowlisted: boolean): Promise<UserRecord> {
    const existing = await this.repository.getUserByEmail(user.email);
    const now = this.now().toISOString();

    const record: UserRecord = {
      id: existing?.id ?? user.id,
      email: user.email.toLowerCase(),
      displayName: user.displayName,
      status: allowlisted ? "active" : "disabled",
      role: existing?.role ?? "user",
      allowlisted,
      createdAt: existing?.createdAt ?? now,
      lastSeenAt: now,
      notificationPreference: existing?.notificationPreference ?? "first_open_email",
    };

    return this.repository.upsertUser(record);
  }

  public async prepareMessage(
    user: AuthenticatedUser,
    request: PrepareTrackedMessageRequest,
  ): Promise<PrepareTrackedMessageResponse> {
    if (!request.htmlBody.trim()) {
      throw new HttpError(400, "htmlBody is required");
    }

    const recipients = normalizeRecipients(request.recipients);
    if (recipients.length === 0) {
      throw new HttpError(400, "At least one recipient is required");
    }
    if (recipients.length > 1) {
      throw new HttpError(400, "Accurate tracking requires exactly one To or Cc recipient per tracked message");
    }

    const trackedMessageId = createId();
    const createdAt = this.now().toISOString();
    const message: TrackedMessage = {
      id: trackedMessageId,
      ownerUserId: user.id,
      gmailMessageId: null,
      gmailThreadId: request.gmailThreadId ?? null,
      draftContextType: request.draftContextType,
      subject: request.subject,
      fromEmail: user.email.toLowerCase(),
      htmlBodyHash: sha256(request.htmlBody),
      trackingEnabled: true,
      trackingAppliedAt: createdAt,
      createdAt,
      sentAt: null,
      status: "draft",
    };

    const recipientsWithTokens = recipients.map<TrackedRecipient>((recipient) => ({
      id: createId(),
      trackedMessageId,
      email: recipient.email,
      recipientType: recipient.recipientType,
      trackingTokenId: createId(),
      firstOpenedAt: null,
      lastOpenedAt: null,
      openCount: 0,
      lastOpenIp: null,
      lastOpenUserAgent: null,
      lastOpenGeo: null,
      notificationSentAt: null,
    }));

    const payloads = recipientsWithTokens.map<PixelTokenPayload>((recipient) => ({
      trackedMessageId,
      trackedRecipientId: recipient.id,
      ownerUserId: user.id,
      tokenId: recipient.trackingTokenId,
      issuedAt: createdAt,
      version: 1,
    }));

    const instrumented = instrumentHtmlBody(
      request.htmlBody,
      recipients,
      payloads,
      this.appBaseUrl,
      this.tokenSecret,
    );

    await this.repository.createDraft({
      message,
      recipients: recipientsWithTokens,
    });

    return {
      trackedMessageId,
      instrumentedHtmlBody: instrumented.html,
      recipients,
      warning: instrumented.warning,
    };
  }

  public async markSent(user: AuthenticatedUser, request: MarkSentRequest): Promise<MessageSummaryResponse> {
    const messageWithRecipients = await this.repository.getMessageById(request.trackedMessageId);
    if (!messageWithRecipients) {
      throw new HttpError(404, "Tracked message not found");
    }
    if (messageWithRecipients.message.ownerUserId !== user.id) {
      throw new HttpError(403, "Forbidden");
    }

    const normalizedRecipients = normalizeRecipients(request.recipients);
    if (normalizedRecipients.length !== 1 || messageWithRecipients.recipients.length !== 1) {
      throw new HttpError(400, "Accurate tracking requires exactly one To or Cc recipient per tracked message");
    }

    const requestedRecipient = normalizedRecipients[0];
    const trackedRecipient = messageWithRecipients.recipients[0];
    if (!requestedRecipient || !trackedRecipient || requestedRecipient.email !== trackedRecipient.email) {
      throw new HttpError(400, "Tracked recipient cannot be changed after tracking is applied");
    }

    const updated = await this.repository.markSent({
      trackedMessageId: request.trackedMessageId,
      gmailMessageId: request.gmailMessageId ?? null,
      gmailThreadId: request.gmailThreadId ?? messageWithRecipients.message.gmailThreadId,
      sentAt: request.sentAt ?? this.now().toISOString(),
      status: messageWithRecipients.message.status === "draft" ? "sent" : messageWithRecipients.message.status,
    });

    return buildSummary(this.repository, updated, messageWithRecipients.recipients);
  }

  public async listMessages(user: AuthenticatedUser, status?: TrackedMessage["status"]): Promise<MessageSummaryResponse[]> {
    const messages = await this.repository.listMessagesByOwner(user.id, status);
    return Promise.all(messages.map(({ message, recipients }) => buildSummary(this.repository, message, recipients)));
  }

  public async getMessageDetail(user: AuthenticatedUser, messageId: string): Promise<MessageDetailResponse> {
    const messageWithRecipients = await this.repository.getMessageById(messageId);
    if (!messageWithRecipients) {
      throw new HttpError(404, "Tracked message not found");
    }
    if (messageWithRecipients.message.ownerUserId !== user.id) {
      throw new HttpError(403, "Forbidden");
    }

    const recipients = await Promise.all(
      messageWithRecipients.recipients.map(async (recipient) => {
        const events = await this.repository.listEventsForRecipient(recipient.id);
        return {
          ...recipient,
          events,
          confidencePercent: calculateConfidencePercent(events),
        };
      }),
    );

    return {
      message: messageWithRecipients.message,
      confidencePercent: calculateMessageConfidencePercent(recipients.map((recipient) => recipient.confidencePercent)),
      recipients,
    };
  }

  public async getMessageDetailByThreadId(
    user: AuthenticatedUser,
    threadId: string,
  ): Promise<ThreadLookupResponse> {
    const messages = await this.repository.listMessagesByOwner(user.id);
    const match = messages
      .filter(({ message }) => message.gmailThreadId === threadId)
      .sort((a, b) => (b.message.sentAt ?? b.message.createdAt).localeCompare(a.message.sentAt ?? a.message.createdAt))[0];

    if (!match) {
      return { message: null };
    }

    return {
      message: await this.getMessageDetail(user, match.message.id),
    };
  }

  public async recordOpen(input: {
    trackedMessageId: string;
    trackedRecipientId: string;
    tokenId: string;
    ip: string;
    userAgent: string;
    referer: string | null;
    acceptLanguage: string | null;
  }): Promise<void> {
    const messageWithRecipients = await this.repository.getMessageByRecipientId(input.trackedRecipientId);
    if (!messageWithRecipients) {
      throw new HttpError(404, "Tracked recipient not found");
    }

    const recipient = messageWithRecipients.recipients.find((entry) => entry.id === input.trackedRecipientId);
    if (!recipient) {
      throw new HttpError(404, "Tracked recipient not found");
    }
    if (
      messageWithRecipients.message.id !== input.trackedMessageId ||
      recipient.trackingTokenId !== input.tokenId
    ) {
      throw new HttpError(404, "Tracked recipient not found");
    }

    const occurredAt = this.now();
    const deliveryPath = classifyDeliveryPath(input.userAgent, input.ip);
    const disposition = classifyEventDisposition({
      message: messageWithRecipients.message,
      deliveryPath,
      occurredAt,
    });
    const dedupeKey = buildDedupeKey({
      tokenId: input.tokenId,
      ip: input.ip,
      userAgent: input.userAgent,
      occurredAt,
      deliveryPath,
      disposition,
    });
    const event: OpenEvent = {
      id: sha256(dedupeKey),
      trackedMessageId: messageWithRecipients.message.id,
      trackedRecipientId: recipient.id,
      occurredAt: occurredAt.toISOString(),
      ip: input.ip,
      userAgent: input.userAgent,
      referer: input.referer,
      acceptLanguage: input.acceptLanguage,
      pixelTokenId: input.tokenId,
      deliveryPath,
      disposition,
      dedupeKey,
      rawHeadersSubset: {
        referer: input.referer,
        "accept-language": input.acceptLanguage,
        "user-agent": input.userAgent,
      },
    };

    const shouldCountTowardOpen = countsTowardOpen(disposition);
    const result = await this.repository.applyOpenEvent(event, shouldCountTowardOpen);
    if (!result.created || !shouldCountTowardOpen || !result.updatedRecipient || !result.updatedMessage) {
      return;
    }

    if (result.wasFirstOpen && result.updatedRecipient.notificationSentAt === null) {
      const owner = await this.repository.getUserByEmail(messageWithRecipients.message.fromEmail);
      if (owner && owner.notificationPreference === "first_open_email") {
        const detailRecipient: MessageRecipientDetailResponse = {
          ...result.updatedRecipient,
          events: [event],
          confidencePercent: calculateConfidencePercent([event]),
        };
        await this.notificationService.sendFirstOpenNotification({
          owner,
          message: result.updatedMessage,
          recipient: detailRecipient,
        });
      }

      await this.repository.markRecipientNotificationSent(result.updatedRecipient.id, event.occurredAt);
    }
  }
}

function normalizeRecipients(recipients: RecipientInput[]): RecipientInput[] {
  const seen = new Set<string>();
  const normalized: RecipientInput[] = [];

  for (const recipient of recipients) {
    const email = recipient.email.trim().toLowerCase();
    if (!email || seen.has(`${recipient.recipientType}:${email}`)) {
      continue;
    }
    seen.add(`${recipient.recipientType}:${email}`);
    normalized.push({
      email,
      recipientType: recipient.recipientType,
    });
  }

  return normalized;
}

function classifyEventDisposition(input: {
  message: TrackedMessage;
  deliveryPath: DeliveryPath;
  occurredAt: Date;
}): EventDisposition {
  const referenceTimestamp = input.message.sentAt ?? input.message.trackingAppliedAt ?? input.message.createdAt;
  const referenceTime = Date.parse(referenceTimestamp);
  const elapsedMs = Number.isNaN(referenceTime) ? Number.POSITIVE_INFINITY : input.occurredAt.getTime() - referenceTime;
  const sendConfirmed = input.message.sentAt !== null;

  if (elapsedMs < 0) {
    return "ignored_sender_or_prefetch";
  }

  // Before Gmail send confirmation, immediate fetches are usually draft previews or sender self-views.
  if (!sendConfirmed && elapsedMs < 2 * 60 * 1000) {
    return "ignored_sender_or_prefetch";
  }

  // After send confirmation, only early proxy fetches are treated as prefetch/self-view noise.
  if (sendConfirmed && input.deliveryPath !== "direct" && elapsedMs < 10 * 1000) {
    return "ignored_sender_or_prefetch";
  }

  if (input.deliveryPath === "gmail_proxy") {
    return "probable_open";
  }

  if (input.deliveryPath === "direct") {
    return "counted";
  }

  return "unconfirmed_privacy_proxy_activity";
}

function countsTowardOpen(disposition: EventDisposition): boolean {
  return disposition === "counted" || disposition === "probable_open";
}

async function buildSummary(
  repository: TrackingRepository,
  message: TrackedMessage,
  recipients: TrackedRecipient[],
): Promise<MessageSummaryResponse> {
  const recipientsWithCountedActivity = recipients.filter((recipient) => recipient.firstOpenedAt !== null);
  const eventLists = await Promise.all(
    recipients.map((recipient) => repository.listEventsForRecipient(recipient.id)),
  );
  const unconfirmedRecipientCount = eventLists.filter((events, index) => {
    if (recipients[index]?.firstOpenedAt !== null) {
      return false;
    }

    return events.some((event) => isUnconfirmedDisposition(event.disposition));
  }).length;
  const recipientConfidencePercents = eventLists.map((events) => calculateConfidencePercent(events));

  return {
    id: message.id,
    subject: message.subject,
    sentAt: message.sentAt,
    status: message.status,
    recipientCount: recipients.length,
    openedRecipientCount: recipientsWithCountedActivity.length,
    unconfirmedRecipientCount,
    confidencePercent: calculateMessageConfidencePercent(recipientConfidencePercents),
  };
}

function calculateMessageConfidencePercent(confidencePercents: number[]): number {
  if (confidencePercents.length === 0) {
    return 0;
  }

  return Math.round(confidencePercents.reduce((sum, value) => sum + value, 0) / confidencePercents.length);
}

function calculateConfidencePercent(events: OpenEvent[]): number {
  const countedEvents = events.filter((event) => event.disposition === "counted");
  const probableEvents = events.filter((event) => event.disposition === "probable_open");
  const unconfirmedEvents = events.filter((event) => isUnconfirmedDisposition(event.disposition));
  const ignoredEvents = events.filter((event) => event.disposition === "ignored_sender_or_prefetch");

  if (countedEvents.length > 0) {
    let confidence = 90;
    if (probableEvents.length > 0) {
      confidence += 5;
    }
    if (countedEvents.length > 1) {
      confidence += Math.min(4, countedEvents.length - 1);
    }
    return Math.min(99, confidence);
  }

  if (probableEvents.length > 0) {
    const probableConfidenceByCount = [78, 86, 91, 94, 96];
    return probableConfidenceByCount[Math.min(probableEvents.length, probableConfidenceByCount.length) - 1] ?? 96;
  }

  if (unconfirmedEvents.length > 0) {
    const proxyConfidenceByCount = [20, 30, 38, 45, 50];
    return proxyConfidenceByCount[Math.min(unconfirmedEvents.length, proxyConfidenceByCount.length) - 1] ?? 50;
  }

  if (ignoredEvents.length > 0) {
    return 5;
  }

  return 0;
}

function isUnconfirmedDisposition(disposition: EventDisposition): boolean {
  return disposition === "unconfirmed_gmail_proxy_activity" ||
    disposition === "unconfirmed_privacy_proxy_activity";
}
