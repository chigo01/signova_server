import { createHash, timingSafeEqual } from "node:crypto";
import { NextFunction, Request, Response } from "express";
import jwt, { JwtPayload } from "jsonwebtoken";
import { env } from "../config/env";

export function constantTimeSecretMatch(
  received: string | undefined,
  expected: string | undefined
): boolean {
  if (!received || !expected) return false;
  const receivedDigest = createHash("sha256").update(received).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(receivedDigest, expectedDigest);
}

export function requireWebinarService(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!env.WEBINAR_SERVICE_SECRET) {
    res.status(503).json({ success: false, message: "Webinar service is not configured" });
    return;
  }

  if (
    !constantTimeSecretMatch(
      req.header("x-webinar-service-secret"),
      env.WEBINAR_SERVICE_SECRET
    )
  ) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }

  next();
}

export function verifyRaffleAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const sessionSecret = env.RAFFLE_ADMIN_SESSION_SECRET;
  const authorization = req.header("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : undefined;

  if (!sessionSecret) {
    res.status(503).json({ success: false, message: "Raffle admin is not configured" });
    return;
  }

  if (!token) {
    res.status(401).json({ success: false, message: "Admin session required" });
    return;
  }

  try {
    const payload = jwt.verify(token, sessionSecret) as JwtPayload;
    if (
      payload.scope !== "webinar:raffle-admin" ||
      payload.sub !== "webinar-raffle-admin"
    ) {
      throw new Error("Invalid raffle scope");
    }
    next();
  } catch {
    res.status(401).json({ success: false, message: "Invalid or expired admin session" });
  }
}
