# Backend

Cloud Run-friendly TypeScript service for:

- add-on APIs
- tracking pixel ingestion
- Firestore persistence
- first-open notifications

## Environment

Copy these into Cloud Run or a local `.env` file:

```bash
PORT=8080
APP_BASE_URL=http://localhost:8080
GOOGLE_CLIENT_ID=your-google-oauth-client-id
ALLOWED_USER_EMAILS=user1@example.com,user2@example.com
TOKEN_SIGNING_SECRET=replace-me
SERVICE_NAME=snoopy
NOTIFICATION_FROM_EMAIL=
```

Firestore uses Application Default Credentials.

## API

- `POST /api/v1/messages/prepare`
- `POST /api/v1/messages/mark-sent`
- `GET /api/v1/messages`
- `GET /api/v1/messages/:id`
- `GET /t/:token.gif`

All `/api` routes require a Google identity token in `Authorization: Bearer ...`.
