import type {
  OpenEvent,
  TrackedMessage,
  TrackedRecipient,
  UserRecord,
} from "../types.js";
import type { MessageWithRecipients, OpenEventWriteResult, TrackingRepository } from "./types.js";

export class InMemoryTrackingRepository implements TrackingRepository {
  private readonly users = new Map<string, UserRecord>();
  private readonly messages = new Map<string, TrackedMessage>();
  private readonly recipients = new Map<string, TrackedRecipient>();
  private readonly events = new Map<string, OpenEvent>();

  public async upsertUser(user: UserRecord): Promise<UserRecord> {
    this.users.set(user.email.toLowerCase(), user);
    return user;
  }

  public async getUserByEmail(email: string): Promise<UserRecord | null> {
    return this.users.get(email.toLowerCase()) ?? null;
  }

  public async createDraft(input: { message: TrackedMessage; recipients: TrackedRecipient[] }): Promise<void> {
    this.messages.set(input.message.id, input.message);
    for (const recipient of input.recipients) {
      this.recipients.set(recipient.id, recipient);
    }
  }

  public async markSent(input: {
    trackedMessageId: string;
    gmailMessageId: string | null;
    gmailThreadId: string | null;
    sentAt: string;
    status: TrackedMessage["status"];
  }): Promise<TrackedMessage> {
    const existing = this.messages.get(input.trackedMessageId);
    if (!existing) {
      throw new Error(`Missing message ${input.trackedMessageId}`);
    }

    const updated: TrackedMessage = {
      ...existing,
      gmailMessageId: input.gmailMessageId,
      gmailThreadId: input.gmailThreadId,
      sentAt: input.sentAt,
      status: input.status,
    };
    this.messages.set(updated.id, updated);
    return updated;
  }

  public async getMessageById(id: string): Promise<MessageWithRecipients | null> {
    const message = this.messages.get(id);
    if (!message) {
      return null;
    }

    return {
      message,
      recipients: [...this.recipients.values()].filter((recipient) => recipient.trackedMessageId === id),
    };
  }

  public async getMessageByRecipientId(recipientId: string): Promise<MessageWithRecipients | null> {
    const recipient = this.recipients.get(recipientId);
    if (!recipient) {
      return null;
    }

    return this.getMessageById(recipient.trackedMessageId);
  }

  public async listMessagesByOwner(ownerUserId: string, status?: TrackedMessage["status"]): Promise<MessageWithRecipients[]> {
    const messages = [...this.messages.values()]
      .filter((message) => message.ownerUserId === ownerUserId && (!status || message.status === status))
      .sort(compareMessagesByMostRecentActivity);

    return messages.map((message) => ({
      message,
      recipients: [...this.recipients.values()].filter((recipient) => recipient.trackedMessageId === message.id),
    }));
  }

  public async applyOpenEvent(event: OpenEvent, countsTowardOpen: boolean): Promise<OpenEventWriteResult> {
    if (this.events.has(event.id)) {
      return {
        created: false,
        updatedMessage: null,
        updatedRecipient: null,
        wasFirstOpen: false,
      };
    }

    this.events.set(event.id, event);

    if (!countsTowardOpen) {
      return {
        created: true,
        updatedMessage: null,
        updatedRecipient: null,
        wasFirstOpen: false,
      };
    }

    const recipient = this.recipients.get(event.trackedRecipientId);
    const message = this.messages.get(event.trackedMessageId);
    if (!recipient || !message) {
      return {
        created: true,
        updatedMessage: null,
        updatedRecipient: null,
        wasFirstOpen: false,
      };
    }

    const wasFirstOpen = recipient.firstOpenedAt === null;
    const updatedRecipient: TrackedRecipient = {
      ...recipient,
      firstOpenedAt: recipient.firstOpenedAt ?? event.occurredAt,
      lastOpenedAt: event.occurredAt,
      openCount: recipient.openCount + 1,
      lastOpenIp: event.ip,
      lastOpenUserAgent: event.userAgent,
    };
    this.recipients.set(updatedRecipient.id, updatedRecipient);

    const recipients = [...this.recipients.values()].filter((entry) => entry.trackedMessageId === event.trackedMessageId);
    const updatedMessage: TrackedMessage = {
      ...message,
      status: calculateMessageStatus(recipients),
    };
    this.messages.set(updatedMessage.id, updatedMessage);

    return {
      created: true,
      updatedMessage,
      updatedRecipient,
      wasFirstOpen,
    };
  }

  public async updateOpenEvent(event: OpenEvent): Promise<void> {
    this.events.set(event.id, event);
  }

  public async updateRecipient(recipient: TrackedRecipient): Promise<void> {
    this.recipients.set(recipient.id, recipient);
  }

  public async markRecipientNotificationSent(recipientId: string, sentAt: string): Promise<void> {
    const recipient = this.recipients.get(recipientId);
    if (!recipient) {
      return;
    }

    this.recipients.set(recipientId, {
      ...recipient,
      notificationSentAt: sentAt,
    });
  }

  public async updateMessage(message: TrackedMessage): Promise<void> {
    this.messages.set(message.id, message);
  }

  public async listEventsForRecipient(recipientId: string): Promise<OpenEvent[]> {
    return [...this.events.values()]
      .filter((event) => event.trackedRecipientId === recipientId)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  }
}

function compareMessagesByMostRecentActivity(a: TrackedMessage, b: TrackedMessage): number {
  const aKey = a.sentAt ?? a.createdAt;
  const bKey = b.sentAt ?? b.createdAt;
  return bKey.localeCompare(aKey);
}

function calculateMessageStatus(recipients: TrackedRecipient[]): TrackedMessage["status"] {
  const openedCount = recipients.filter((recipient) => recipient.firstOpenedAt !== null).length;
  if (openedCount === 0) {
    return "sent";
  }

  return openedCount >= recipients.length ? "fully_opened" : "partially_opened";
}
