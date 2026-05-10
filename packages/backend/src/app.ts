import cors from "cors";
import express from "express";
import morgan from "morgan";
import { z } from "zod";
import { HttpError } from "./errors.js";
import { transparentGifBuffer } from "./lib/pixel.js";
import { verifyPixelToken } from "./lib/token.js";
import { requireAuth } from "./auth.js";
import type { TrackerService } from "./services/tracker.js";
import type { TrackedMessage } from "./types.js";

const prepareSchema = z.object({
  subject: z.string().default(""),
  htmlBody: z.string(),
  recipients: z.array(z.object({
    email: z.string().email(),
    recipientType: z.enum(["to", "cc"]),
  })),
  draftContextType: z.enum(["new", "reply"]),
  gmailThreadId: z.string().nullable().optional(),
});

const markSentSchema = z.object({
  trackedMessageId: z.string().uuid(),
  gmailMessageId: z.string().nullable().optional(),
  gmailThreadId: z.string().nullable().optional(),
  recipients: z.array(z.object({
    email: z.string().email(),
    recipientType: z.enum(["to", "cc"]),
  })),
});

export function createApp(input: {
  authMiddleware: express.RequestHandler;
  trackerService: TrackerService;
  tokenSigningSecret: string;
  allowedUserEmails: Set<string>;
}) {
  const app = express();
  app.set("trust proxy", true);
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(morgan("tiny"));

  app.get("/healthz", (_request, response) => {
    response.json({ ok: true });
  });

  app.use("/api", input.authMiddleware);

  app.get("/api/v1/me", async (request, response, next) => {
    try {
      const user = requireAuth(request);
      const allowlisted = input.allowedUserEmails.has(user.email);
      const synced = await input.trackerService.syncUser(user, allowlisted);

      if (!allowlisted) {
        throw new HttpError(403, "User is not allowlisted");
      }

      response.json({
        id: synced.id,
        email: synced.email,
        displayName: synced.displayName,
        notificationPreference: synced.notificationPreference,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/messages/prepare", async (request, response, next) => {
    try {
      const user = requireAuth(request);
      const allowlisted = input.allowedUserEmails.has(user.email);
      await input.trackerService.syncUser(user, allowlisted);
      if (!allowlisted) {
        throw new HttpError(403, "User is not allowlisted");
      }

      const payload = prepareSchema.parse(request.body);
      const result = await input.trackerService.prepareMessage(user, payload);
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/messages/mark-sent", async (request, response, next) => {
    try {
      const user = requireAuth(request);
      const allowlisted = input.allowedUserEmails.has(user.email);
      await input.trackerService.syncUser(user, allowlisted);
      if (!allowlisted) {
        throw new HttpError(403, "User is not allowlisted");
      }

      const payload = markSentSchema.parse(request.body);
      const result = await input.trackerService.markSent(user, payload);
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/messages", async (request, response, next) => {
    try {
      const user = requireAuth(request);
      const allowlisted = input.allowedUserEmails.has(user.email);
      await input.trackerService.syncUser(user, allowlisted);
      if (!allowlisted) {
        throw new HttpError(403, "User is not allowlisted");
      }

      const statusParam = request.query.status;
      const status = typeof statusParam === "string" ? statusParam as TrackedMessage["status"] : undefined;
      const result = await input.trackerService.listMessages(user, status);
      response.json({ items: result });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/messages/:id", async (request, response, next) => {
    try {
      const user = requireAuth(request);
      const allowlisted = input.allowedUserEmails.has(user.email);
      await input.trackerService.syncUser(user, allowlisted);
      if (!allowlisted) {
        throw new HttpError(403, "User is not allowlisted");
      }

      const result = await input.trackerService.getMessageDetail(user, request.params.id);
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/t/:token.gif", async (request, response, next) => {
    try {
      const token = request.params.token;
      const payload = verifyPixelToken(token, input.tokenSigningSecret);
      if (!payload) {
        throw new HttpError(404, "Invalid tracking token");
      }

      const forwardedFor = request.header("x-forwarded-for");
      const ip = forwardedFor?.split(",")[0]?.trim() || request.ip || "unknown";
      const userAgent = request.header("user-agent") ?? "unknown";

      await input.trackerService.recordOpen({
        trackedRecipientId: payload.trackedRecipientId,
        tokenId: payload.tokenId,
        ip,
        userAgent,
        referer: request.header("referer") ?? null,
        acceptLanguage: request.header("accept-language") ?? null,
      });

      response
        .status(200)
        .setHeader("Content-Type", "image/gif")
        .setHeader("Content-Length", String(transparentGifBuffer.length))
        .setHeader("Cache-Control", "private, no-cache, no-store, max-age=0, must-revalidate")
        .setHeader("Pragma", "no-cache")
        .end(transparentGifBuffer);
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error instanceof z.ZodError) {
      response.status(400).json({
        error: "Invalid request",
        issues: error.issues,
      });
      return;
    }

    if (error instanceof HttpError) {
      response.status(error.statusCode).json({ error: error.message });
      return;
    }

    const message = error instanceof Error ? error.message : "Internal server error";
    response.status(500).json({ error: message });
  });

  return app;
}
