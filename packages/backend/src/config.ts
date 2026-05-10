import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const schema = z.object({
  NODE_ENV: z.string().optional(),
  PORT: z.coerce.number().default(8080),
  APP_BASE_URL: z.string().url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  ALLOWED_USER_EMAILS: z.string().default(""),
  TOKEN_SIGNING_SECRET: z.string().min(32),
  FIRESTORE_PROJECT_ID: z.string().optional(),
  GMAIL_NOTIFICATION_CLIENT_ID: z.string().optional(),
  GMAIL_NOTIFICATION_CLIENT_SECRET: z.string().optional(),
  GMAIL_NOTIFICATION_REFRESH_TOKEN: z.string().optional(),
  NOTIFICATION_FROM_EMAIL: z.string().email().optional(),
  SERVICE_NAME: z.string().default("snoopy"),
});

const env = schema.parse(process.env);

export const config = {
  nodeEnv: env.NODE_ENV ?? "development",
  port: env.PORT,
  appBaseUrl: env.APP_BASE_URL.replace(/\/$/, ""),
  googleClientId: env.GOOGLE_CLIENT_ID,
  allowedUserEmails: new Set(
    env.ALLOWED_USER_EMAILS.split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  ),
  tokenSigningSecret: env.TOKEN_SIGNING_SECRET,
  firestoreProjectId: env.FIRESTORE_PROJECT_ID,
  serviceName: env.SERVICE_NAME,
  gmailNotification: env.GMAIL_NOTIFICATION_CLIENT_ID &&
    env.GMAIL_NOTIFICATION_CLIENT_SECRET &&
    env.GMAIL_NOTIFICATION_REFRESH_TOKEN &&
    env.NOTIFICATION_FROM_EMAIL
    ? {
        clientId: env.GMAIL_NOTIFICATION_CLIENT_ID,
        clientSecret: env.GMAIL_NOTIFICATION_CLIENT_SECRET,
        refreshToken: env.GMAIL_NOTIFICATION_REFRESH_TOKEN,
        fromEmail: env.NOTIFICATION_FROM_EMAIL,
      }
    : null,
};
