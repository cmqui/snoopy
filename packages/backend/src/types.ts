export type DraftContextType = "new" | "reply";
export type RecipientType = "to" | "cc";
export type MessageStatus = "draft" | "sent" | "partially_opened" | "fully_opened";
export type DeliveryPath = "direct" | "gmail_proxy" | "unknown";
export type NotificationPreference = "first_open_email" | "off";
export type EventDisposition = "counted" | "ignored_sender_or_prefetch";

export interface UserRecord {
  id: string;
  email: string;
  displayName: string | null;
  status: "active" | "disabled";
  role: "user" | "admin";
  allowlisted: boolean;
  createdAt: string;
  lastSeenAt: string;
  notificationPreference: NotificationPreference;
}

export interface TrackedMessage {
  id: string;
  ownerUserId: string;
  gmailMessageId: string | null;
  gmailThreadId: string | null;
  draftContextType: DraftContextType;
  subject: string;
  fromEmail: string;
  htmlBodyHash: string;
  trackingEnabled: boolean;
  createdAt: string;
  sentAt: string | null;
  status: MessageStatus;
}

export interface TrackedRecipient {
  id: string;
  trackedMessageId: string;
  email: string;
  recipientType: RecipientType;
  trackingTokenId: string;
  firstOpenedAt: string | null;
  lastOpenedAt: string | null;
  openCount: number;
  lastOpenIp: string | null;
  lastOpenUserAgent: string | null;
  lastOpenGeo: string | null;
  notificationSentAt: string | null;
}

export interface OpenEvent {
  id: string;
  trackedMessageId: string;
  trackedRecipientId: string;
  occurredAt: string;
  ip: string;
  userAgent: string;
  referer: string | null;
  acceptLanguage: string | null;
  pixelTokenId: string;
  deliveryPath: DeliveryPath;
  disposition: EventDisposition;
  dedupeKey: string;
  rawHeadersSubset: Record<string, string | null>;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string | null;
}

export interface RecipientInput {
  email: string;
  recipientType: RecipientType;
}

export interface PrepareTrackedMessageRequest {
  subject: string;
  htmlBody: string;
  recipients: RecipientInput[];
  draftContextType: DraftContextType;
  gmailThreadId?: string | null;
}

export interface PrepareTrackedMessageResponse {
  trackedMessageId: string;
  instrumentedHtmlBody: string;
  recipients: RecipientInput[];
  warning: string | null;
}

export interface MarkSentRequest {
  trackedMessageId: string;
  gmailMessageId?: string | null;
  gmailThreadId?: string | null;
  recipients: RecipientInput[];
}

export interface MessageSummaryResponse {
  id: string;
  subject: string;
  sentAt: string | null;
  status: MessageStatus;
  recipientCount: number;
  openedRecipientCount: number;
}

export interface MessageRecipientDetailResponse extends TrackedRecipient {
  events: OpenEvent[];
}

export interface MessageDetailResponse {
  message: TrackedMessage;
  recipients: MessageRecipientDetailResponse[];
}

export interface PixelTokenPayload {
  trackedMessageId: string;
  trackedRecipientId: string;
  ownerUserId: string;
  tokenId: string;
  issuedAt: string;
  version: number;
}
