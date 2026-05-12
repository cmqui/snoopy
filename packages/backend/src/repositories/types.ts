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

export interface OpenEventWriteResult {
  created: boolean;
  updatedMessage: TrackedMessage | null;
  updatedRecipient: TrackedRecipient | null;
  wasFirstOpen: boolean;
}

export interface TrackingRepository {
  upsertUser(user: UserRecord): Promise<UserRecord>;
  getUserByEmail(email: string): Promise<UserRecord | null>;
  createDraft(input: { message: TrackedMessage; recipients: TrackedRecipient[] }): Promise<void>;
  markSent(input: {
    trackedMessageId: string;
    gmailMessageId: string | null;
    gmailThreadId: string | null;
    sentAt: string;
    status: TrackedMessage["status"];
  }): Promise<TrackedMessage>;
  getMessageById(id: string): Promise<MessageWithRecipients | null>;
  getMessageByRecipientId(recipientId: string): Promise<MessageWithRecipients | null>;
  listMessagesByOwner(ownerUserId: string, status?: TrackedMessage["status"]): Promise<MessageWithRecipients[]>;
  applyOpenEvent(event: OpenEvent, countsTowardOpen: boolean): Promise<OpenEventWriteResult>;
  updateOpenEvent(event: OpenEvent): Promise<void>;
  updateRecipient(recipient: TrackedRecipient): Promise<void>;
  markRecipientNotificationSent(recipientId: string, sentAt: string): Promise<void>;
  updateMessage(message: TrackedMessage): Promise<void>;
  listEventsForRecipient(recipientId: string): Promise<OpenEvent[]>;
}
