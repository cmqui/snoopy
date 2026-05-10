import { createGoogleAuthMiddleware } from "./auth.js";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { FirestoreTrackingRepository } from "./repositories/firestore.js";
import { GmailNotificationService, NoopNotificationService } from "./services/notifier.js";
import { TrackerService } from "./services/tracker.js";

const repository = new FirestoreTrackingRepository(config.firestoreProjectId);
const notificationService = config.gmailNotification
  ? new GmailNotificationService(config.gmailNotification)
  : new NoopNotificationService();
const trackerService = new TrackerService(
  repository,
  notificationService,
  config.tokenSigningSecret,
  config.appBaseUrl,
);
const app = createApp({
  authMiddleware: createGoogleAuthMiddleware(config.googleClientId),
  trackerService,
  tokenSigningSecret: config.tokenSigningSecret,
  allowedUserEmails: config.allowedUserEmails,
});

app.listen(config.port, () => {
  console.log(`snoopy backend listening on ${config.port}`);
});
