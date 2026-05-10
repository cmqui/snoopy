import { Firestore } from "@google-cloud/firestore";
import type {
  OpenEvent,
  TrackedMessage,
  TrackedRecipient,
  UserRecord,
} from "../types.js";
import type { MessageWithRecipients, OpenEventWriteResult, TrackingRepository } from "./types.js";

type FirestoreCollections = "users" | "tracked_messages" | "tracked_recipients" | "open_events";

export class FirestoreTrackingRepository implements TrackingRepository {
  private readonly firestore: Firestore;

  public constructor(projectId?: string) {
    this.firestore = new Firestore(projectId ? { projectId } : {});
  }

  public async upsertUser(user: UserRecord): Promise<UserRecord> {
    await this.collection("users").doc(user.id).set(user, { merge: true });
    return user;
  }

  public async getUserByEmail(email: string): Promise<UserRecord | null> {
    const snapshot = await this.collection("users").where("email", "==", email.toLowerCase()).limit(1).get();
    if (snapshot.empty) {
      return null;
    }

    const [firstDoc] = snapshot.docs;
    if (!firstDoc) {
      return null;
    }

    return firstDoc.data() as UserRecord;
  }

  public async createDraft(input: { message: TrackedMessage; recipients: TrackedRecipient[] }): Promise<void> {
    const batch = this.firestore.batch();
    batch.set(this.collection("tracked_messages").doc(input.message.id), input.message);
    for (const recipient of input.recipients) {
      batch.set(this.collection("tracked_recipients").doc(recipient.id), recipient);
    }
    await batch.commit();
  }

  public async markSent(input: {
    trackedMessageId: string;
    gmailMessageId: string | null;
    gmailThreadId: string | null;
    sentAt: string;
    status: TrackedMessage["status"];
  }): Promise<TrackedMessage> {
    const ref = this.collection("tracked_messages").doc(input.trackedMessageId);
    const snapshot = await ref.get();
    if (!snapshot.exists) {
      throw new Error(`Missing message ${input.trackedMessageId}`);
    }

    const existing = snapshot.data() as TrackedMessage;
    const updated: TrackedMessage = {
      ...existing,
      gmailMessageId: input.gmailMessageId,
      gmailThreadId: input.gmailThreadId,
      sentAt: input.sentAt,
      status: input.status,
    };

    const batch = this.firestore.batch();
    batch.set(ref, updated);
    await batch.commit();

    return updated;
  }

  public async getMessageById(id: string): Promise<MessageWithRecipients | null> {
    const snapshot = await this.collection("tracked_messages").doc(id).get();
    if (!snapshot.exists) {
      return null;
    }

    const message = snapshot.data() as TrackedMessage;
    const recipientsSnapshot = await this.collection("tracked_recipients")
      .where("trackedMessageId", "==", id)
      .get();

    return {
      message,
      recipients: recipientsSnapshot.docs.map((doc) => doc.data() as TrackedRecipient),
    };
  }

  public async getMessageByRecipientId(recipientId: string): Promise<MessageWithRecipients | null> {
    const recipientSnapshot = await this.collection("tracked_recipients").doc(recipientId).get();
    if (!recipientSnapshot.exists) {
      return null;
    }

    const recipient = recipientSnapshot.data() as TrackedRecipient;
    return this.getMessageById(recipient.trackedMessageId);
  }

  public async listMessagesByOwner(ownerUserId: string, status?: TrackedMessage["status"]): Promise<MessageWithRecipients[]> {
    let query = this.collection("tracked_messages").where("ownerUserId", "==", ownerUserId);
    if (status) {
      query = query.where("status", "==", status);
    }

    const snapshot = await query.get();
    const messages = snapshot.docs
      .map((doc) => doc.data() as TrackedMessage)
      .sort(compareMessagesByMostRecentActivity);

    return Promise.all(messages.map(async (message) => {
      const recipientsSnapshot = await this.collection("tracked_recipients")
        .where("trackedMessageId", "==", message.id)
        .get();
      return {
        message,
        recipients: recipientsSnapshot.docs.map((doc) => doc.data() as TrackedRecipient),
      };
    }));
  }

  public async applyOpenEvent(event: OpenEvent, countsTowardOpen: boolean): Promise<OpenEventWriteResult> {
    const eventRef = this.collection("open_events").doc(event.id);
    const recipientRef = this.collection("tracked_recipients").doc(event.trackedRecipientId);
    const messageRef = this.collection("tracked_messages").doc(event.trackedMessageId);
    const recipientsQuery = this.collection("tracked_recipients").where("trackedMessageId", "==", event.trackedMessageId);

    return this.firestore.runTransaction(async (transaction) => {
      const eventSnapshot = await transaction.get(eventRef);
      if (eventSnapshot.exists) {
        return {
          created: false,
          updatedMessage: null,
          updatedRecipient: null,
          wasFirstOpen: false,
        };
      }

      if (!countsTowardOpen) {
        transaction.create(eventRef, event);
        return {
          created: true,
          updatedMessage: null,
          updatedRecipient: null,
          wasFirstOpen: false,
        };
      }

      const [recipientSnapshot, messageSnapshot, recipientsSnapshot] = await Promise.all([
        transaction.get(recipientRef),
        transaction.get(messageRef),
        transaction.get(recipientsQuery),
      ]);

      transaction.create(eventRef, event);

      if (!recipientSnapshot.exists || !messageSnapshot.exists) {
        return {
          created: true,
          updatedMessage: null,
          updatedRecipient: null,
          wasFirstOpen: false,
        };
      }

      const recipient = recipientSnapshot.data() as TrackedRecipient;
      const message = messageSnapshot.data() as TrackedMessage;
      const wasFirstOpen = recipient.firstOpenedAt === null;
      const updatedRecipient: TrackedRecipient = {
        ...recipient,
        firstOpenedAt: recipient.firstOpenedAt ?? event.occurredAt,
        lastOpenedAt: event.occurredAt,
        openCount: recipient.openCount + 1,
        lastOpenIp: event.ip,
        lastOpenUserAgent: event.userAgent,
      };

      const recipients = recipientsSnapshot.docs.map((doc) => doc.data() as TrackedRecipient);
      const updatedRecipients = recipients.map((entry) => entry.id === updatedRecipient.id ? updatedRecipient : entry);
      const updatedMessage: TrackedMessage = {
        ...message,
        status: calculateMessageStatus(updatedRecipients),
      };

      transaction.set(recipientRef, updatedRecipient);
      transaction.set(messageRef, updatedMessage);

      return {
        created: true,
        updatedMessage,
        updatedRecipient,
        wasFirstOpen,
      };
    });
  }

  public async updateRecipient(recipient: TrackedRecipient): Promise<void> {
    await this.collection("tracked_recipients").doc(recipient.id).set(recipient);
  }

  public async markRecipientNotificationSent(recipientId: string, sentAt: string): Promise<void> {
    await this.collection("tracked_recipients").doc(recipientId).set({
      notificationSentAt: sentAt,
    }, { merge: true });
  }

  public async updateMessage(message: TrackedMessage): Promise<void> {
    await this.collection("tracked_messages").doc(message.id).set(message);
  }

  public async listEventsForRecipient(recipientId: string): Promise<OpenEvent[]> {
    const snapshot = await this.collection("open_events")
      .where("trackedRecipientId", "==", recipientId)
      .get();

    return snapshot.docs
      .map((doc) => doc.data() as OpenEvent)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  }

  private collection(name: FirestoreCollections) {
    return this.firestore.collection(name);
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
