import type {
  OpenEvent,
  TrackedMessage,
  TrackedRecipient,
  UserRecord,
} from "../types.js";
import type { MessageWithRecipients, TrackingRepository } from "./types.js";

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
    recipients: TrackedRecipient[];
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
    for (const recipient of input.recipients) {
      this.recipients.set(recipient.id, recipient);
    }
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
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return messages.map((message) => ({
      message,
      recipients: [...this.recipients.values()].filter((recipient) => recipient.trackedMessageId === message.id),
    }));
  }

  public async hasOpenEventByDedupeKey(dedupeKey: string): Promise<boolean> {
    return [...this.events.values()].some((event) => event.dedupeKey === dedupeKey);
  }

  public async createOpenEvent(event: OpenEvent): Promise<void> {
    this.events.set(event.id, event);
  }

  public async updateRecipient(recipient: TrackedRecipient): Promise<void> {
    this.recipients.set(recipient.id, recipient);
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
