import { google } from "googleapis";
import type { MessageRecipientDetailResponse, TrackedMessage, UserRecord } from "../types.js";

export interface NotificationService {
  sendFirstOpenNotification(input: {
    owner: UserRecord;
    message: TrackedMessage;
    recipient: MessageRecipientDetailResponse;
  }): Promise<void>;
}

export class NoopNotificationService implements NotificationService {
  public async sendFirstOpenNotification(): Promise<void> {
    return Promise.resolve();
  }
}

export class GmailNotificationService implements NotificationService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly refreshToken: string;
  private readonly fromEmail: string;

  public constructor(input: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    fromEmail: string;
  }) {
    this.clientId = input.clientId;
    this.clientSecret = input.clientSecret;
    this.refreshToken = input.refreshToken;
    this.fromEmail = input.fromEmail;
  }

  public async sendFirstOpenNotification(input: {
    owner: UserRecord;
    message: TrackedMessage;
    recipient: MessageRecipientDetailResponse;
  }): Promise<void> {
    const oauth2Client = new google.auth.OAuth2(this.clientId, this.clientSecret);
    oauth2Client.setCredentials({ refresh_token: this.refreshToken });

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });
    const firstOpenedAt = input.recipient.firstOpenedAt ?? "unknown";
    const body = [
      `Subject: ${input.message.subject}`,
      `Recipient: ${input.recipient.email}`,
      `First opened: ${firstOpenedAt}`,
      `Logged IP: ${input.recipient.lastOpenIp ?? "unknown"}`,
      "",
      "Note: Gmail may proxy remote images, so this IP may belong to Google rather than the recipient.",
    ].join("\n");

    const raw = Buffer.from(
      [
        `From: Snoopy <${this.fromEmail}>`,
        `To: ${input.owner.email}`,
        `Subject: Email opened: ${input.message.subject}`,
        "Content-Type: text/plain; charset=utf-8",
        "",
        body,
      ].join("\r\n"),
    ).toString("base64url");

    await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });
  }
}
