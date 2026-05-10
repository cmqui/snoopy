import type {
  OpenEvent,
  TrackedMessage,
  TrackedRecipient,
  UserRecord,
} from "../types.js";

export interface MessageWithRecipients {
  message: TrackedMessage;
  recipients: TrackedRecipient[];
}

export interface TrackingRepository {
  upsertUser(user: UserRecord): Promise<UserRecord>;
  getUserByEmail(email: string): Promise<UserRecord | null>;
  createDraft(input: { message: TrackedMessage; recipients: TrackedRecipient[] }): Promise<void>;
  markSent(input: {
    trackedMessageId: string;
    gmailMessageId: string | null;
    gmailThreadId: string | null;
    recipients: TrackedRecipient[];
    sentAt: string;
    status: TrackedMessage["status"];
  }): Promise<TrackedMessage>;
  getMessageById(id: string): Promise<MessageWithRecipients | null>;
  getMessageByRecipientId(recipientId: string): Promise<MessageWithRecipients | null>;
  listMessagesByOwner(ownerUserId: string, status?: TrackedMessage["status"]): Promise<MessageWithRecipients[]>;
  hasOpenEventByDedupeKey(dedupeKey: string): Promise<boolean>;
  createOpenEvent(event: OpenEvent): Promise<void>;
  updateRecipient(recipient: TrackedRecipient): Promise<void>;
  updateMessage(message: TrackedMessage): Promise<void>;
  listEventsForRecipient(recipientId: string): Promise<OpenEvent[]>;
}
