import { OAuth2Client } from "google-auth-library";
import type { Request, Response, NextFunction } from "express";
import { HttpError } from "./errors.js";
import type { AuthenticatedUser } from "./types.js";

export interface AuthContext {
  user: AuthenticatedUser;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export function createGoogleAuthMiddleware(clientId: string) {
  const client = new OAuth2Client(clientId);

  return async function googleAuthMiddleware(request: Request, _response: Response, next: NextFunction) {
    try {
      const authorization = request.header("authorization");
      if (!authorization?.startsWith("Bearer ")) {
        throw new HttpError(401, "Missing bearer token");
      }

      const token = authorization.slice("Bearer ".length);
      const ticket = await client.verifyIdToken({
        idToken: token,
        audience: clientId,
      });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email) {
        throw new HttpError(401, "Invalid token payload");
      }

      request.auth = {
        user: {
          id: payload.sub,
          email: payload.email.toLowerCase(),
          displayName: payload.name ?? null,
        },
      };

      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireAuth(request: Request): AuthenticatedUser {
  if (!request.auth) {
    throw new HttpError(401, "Authentication required");
  }
  return request.auth.user;
}
