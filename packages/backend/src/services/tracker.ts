import { HttpError } from "../errors.js";
import { createId, sha256 } from "../lib/crypto.js";
import { instrumentHtmlBody } from "../lib/html.js";
import { buildDedupeKey, classifyDeliveryPath } from "../lib/proxy.js";
import type { TrackingRepository } from "../repositories/types.js";
import type {
  AuthenticatedUser,
  MarkSentRequest,
  MessageDetailResponse,
  MessageRecipientDetailResponse,
  MessageSummaryResponse,
  OpenEvent,
  PixelTokenPayload,
  PrepareTrackedMessageRequest,
  PrepareTrackedMessageResponse,
  RecipientInput,
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
  ) {}

  public async syncUser(user: AuthenticatedUser, allowlisted: boolean): Promise<UserRecord> {
    const existing = await this.repository.getUserByEmail(user.email);
    const now = new Date().toISOString();

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

    const trackedMessageId = createId();
    const createdAt = new Date().toISOString();
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
    const recipientMap = new Map(
      messageWithRecipients.recipients.map((recipient) => [recipient.email.toLowerCase(), recipient]),
    );

    const updatedRecipients = normalizedRecipients.map((recipient) => {
      const existing = recipientMap.get(recipient.email.toLowerCase());
      if (!existing) {
        return {
          id: createId(),
          trackedMessageId: messageWithRecipients.message.id,
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
        } satisfies TrackedRecipient;
      }

      return {
        ...existing,
        recipientType: recipient.recipientType,
      };
    });

    const updated = await this.repository.markSent({
      trackedMessageId: request.trackedMessageId,
      gmailMessageId: request.gmailMessageId ?? null,
      gmailThreadId: request.gmailThreadId ?? messageWithRecipients.message.gmailThreadId,
      recipients: updatedRecipients,
      sentAt: new Date().toISOString(),
      status: "sent",
    });

    return toSummary(updated, updatedRecipients);
  }

  public async listMessages(user: AuthenticatedUser, status?: TrackedMessage["status"]): Promise<MessageSummaryResponse[]> {
    const messages = await this.repository.listMessagesByOwner(user.id, status);
    return messages.map(({ message, recipients }) => toSummary(message, recipients));
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
      messageWithRecipients.recipients.map(async (recipient) => ({
        ...recipient,
        events: await this.repository.listEventsForRecipient(recipient.id),
      })),
    );

    return {
      message: messageWithRecipients.message,
      recipients,
    };
  }

  public async recordOpen(input: {
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

    const occurredAt = new Date();
    const dedupeKey = buildDedupeKey(input.tokenId, input.ip, input.userAgent, occurredAt);
    const alreadySeen = await this.repository.hasOpenEventByDedupeKey(dedupeKey);
    if (alreadySeen) {
      return;
    }

    const deliveryPath = classifyDeliveryPath(input.userAgent, input.ip);
    const event: OpenEvent = {
      id: createId(),
      trackedMessageId: messageWithRecipients.message.id,
      trackedRecipientId: recipient.id,
      occurredAt: occurredAt.toISOString(),
      ip: input.ip,
      userAgent: input.userAgent,
      referer: input.referer,
      acceptLanguage: input.acceptLanguage,
      pixelTokenId: input.tokenId,
      deliveryPath,
      dedupeKey,
      rawHeadersSubset: {
        referer: input.referer,
        "accept-language": input.acceptLanguage,
        "user-agent": input.userAgent,
      },
    };

    await this.repository.createOpenEvent(event);

    const updatedRecipient: TrackedRecipient = {
      ...recipient,
      firstOpenedAt: recipient.firstOpenedAt ?? event.occurredAt,
      lastOpenedAt: event.occurredAt,
      openCount: recipient.openCount + 1,
      lastOpenIp: input.ip,
      lastOpenUserAgent: input.userAgent,
    };
    await this.repository.updateRecipient(updatedRecipient);

    const updatedRecipients = messageWithRecipients.recipients.map((entry) =>
      entry.id === recipient.id ? updatedRecipient : entry
    );
    const openedCount = updatedRecipients.filter((entry) => entry.firstOpenedAt !== null).length;
    const messageStatus = openedCount === 0
      ? "sent"
      : openedCount >= updatedRecipients.length
      ? "fully_opened"
      : "partially_opened";

    await this.repository.updateMessage({
      ...messageWithRecipients.message,
      status: messageStatus,
    });

    if (updatedRecipient.notificationSentAt === null) {
      const owner = await this.repository.getUserByEmail(messageWithRecipients.message.fromEmail);
      if (owner && owner.notificationPreference === "first_open_email") {
        const detailRecipient: MessageRecipientDetailResponse = {
          ...updatedRecipient,
          events: [event],
        };
        await this.notificationService.sendFirstOpenNotification({
          owner,
          message: { ...messageWithRecipients.message, status: messageStatus },
          recipient: detailRecipient,
        });
      }

      await this.repository.updateRecipient({
        ...updatedRecipient,
        notificationSentAt: event.occurredAt,
      });
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

function toSummary(message: TrackedMessage, recipients: TrackedRecipient[]): MessageSummaryResponse {
  return {
    id: message.id,
    subject: message.subject,
    sentAt: message.sentAt,
    status: message.status,
    recipientCount: recipients.length,
    openedRecipientCount: recipients.filter((recipient) => recipient.firstOpenedAt !== null).length,
  };
}
