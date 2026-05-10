import { Firestore } from "@google-cloud/firestore";
import type {
  OpenEvent,
  TrackedMessage,
  TrackedRecipient,
  UserRecord,
} from "../types.js";
import type { MessageWithRecipients, TrackingRepository } from "./types.js";

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
    recipients: TrackedRecipient[];
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
    for (const recipient of input.recipients) {
      batch.set(this.collection("tracked_recipients").doc(recipient.id), recipient);
    }
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
    const messages = snapshot.docs.map((doc) => doc.data() as TrackedMessage);

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

  public async hasOpenEventByDedupeKey(dedupeKey: string): Promise<boolean> {
    const snapshot = await this.collection("open_events").where("dedupeKey", "==", dedupeKey).limit(1).get();
    return !snapshot.empty;
  }

  public async createOpenEvent(event: OpenEvent): Promise<void> {
    await this.collection("open_events").doc(event.id).set(event);
  }

  public async updateRecipient(recipient: TrackedRecipient): Promise<void> {
    await this.collection("tracked_recipients").doc(recipient.id).set(recipient);
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
