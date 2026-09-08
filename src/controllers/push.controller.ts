import type { Request, Response } from "express";
import { env } from "../config/env";
import PushInstallation, {
  type PushPlatform,
} from "../models/pushInstallation.model";
import PushBroadcastNotification from "../models/pushBroadcastNotification.model";
import User from "../models/user.model";
import { AppError } from "../middleware/errorHandler";
import { deriveFirstName } from "../services/email/templates/_shared";
import {
  sendBroadcastPush,
  type PushDeliveryResult,
  type PushRecipient,
} from "../services/pushNotification.service";

const REGISTRATION_TOKEN_MAX_LENGTH = 4096;
const APP_VERSION_MAX_LENGTH = 64;

function requireAuthenticatedUserId(req: Request): string {
  if (!req.user) {
    throw new AppError(401, "Unauthorized");
  }
  return req.user.userId;
}

function parseRegistrationToken(value: unknown): string {
  if (typeof value !== "string") {
    throw new AppError(400, "registrationToken must be a string");
  }
  const registrationToken = value.trim();
  if (
    registrationToken.length === 0 ||
    registrationToken.length > REGISTRATION_TOKEN_MAX_LENGTH ||
    /\s/.test(registrationToken)
  ) {
    throw new AppError(400, "registrationToken is invalid");
  }
  return registrationToken;
}

function parsePlatform(value: unknown): PushPlatform {
  if (value !== "android" && value !== "ios") {
    throw new AppError(400, "platform must be android or ios");
  }
  return value;
}

function parseAppVersion(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new AppError(400, "appVersion must be a string");
  }
  const appVersion = value.trim();
  if (!appVersion || appVersion.length > APP_VERSION_MAX_LENGTH) {
    throw new AppError(400, "appVersion is invalid");
  }
  return appVersion;
}

export async function registerPushDevice(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = requireAuthenticatedUserId(req);
  const registrationToken = parseRegistrationToken(
    req.body?.registrationToken,
  );
  const platform = parsePlatform(req.body?.platform);
  const appVersion = parseAppVersion(req.body?.appVersion);

  const installation = await PushInstallation.findOneAndUpdate(
    { installationId: registrationToken },
    {
      $set: {
        userId,
        platform,
        appVersion,
        registrationType: "fcm_token",
        enabled: true,
        lastSeenAt: new Date(),
      },
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
  );

  res.status(200).json({
    message: "Push device registered",
    installation: {
      registrationToken: installation.installationId,
      platform: installation.platform,
    },
  });
}

export async function unregisterPushDevice(
  req: Request,
  res: Response,
): Promise<void> {
  const userId = requireAuthenticatedUserId(req);
  const registrationToken = parseRegistrationToken(
    req.body?.registrationToken,
  );

  await PushInstallation.updateOne(
    {
      installationId: registrationToken,
      registrationType: "fcm_token",
      userId,
    },
    { $set: { enabled: false } },
  );

  // Idempotent by design. Do not reveal whether an installation belongs to a
  // different account.
  res.status(200).json({ message: "Push device unregistered" });
}

export const BROADCAST_TITLE_MAX_LENGTH = 80;
export const BROADCAST_BODY_MAX_LENGTH = 240;
export const BROADCAST_EMAILS_MAX = 50;
export const BROADCAST_SCREEN_MAX_LENGTH = 64;
export const BROADCAST_DEDUP_KEY_MAX_LENGTH = 200;

const EMAIL_FORMAT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SCREEN_FORMAT_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export type BroadcastPushRequest = {
  title: string;
  body: string;
  screen?: string;
  emails?: string[];
  dedupKey?: string;
};

function parseBoundedString(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    throw new AppError(400, `${field} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new AppError(400, `${field} is required`);
  }
  if (trimmed.length > maxLength) {
    throw new AppError(400, `${field} must be at most ${maxLength} characters`);
  }
  return trimmed;
}

export function parseBroadcastPushPayload(body: unknown): BroadcastPushRequest {
  if (!body || typeof body !== "object") {
    throw new AppError(400, "Invalid broadcast payload");
  }
  const record = body as Record<string, unknown>;
  const title = parseBoundedString(
    record.title,
    "title",
    BROADCAST_TITLE_MAX_LENGTH,
  );
  const bodyText = parseBoundedString(
    record.body,
    "body",
    BROADCAST_BODY_MAX_LENGTH,
  );

  let screen: string | undefined;
  if (record.screen !== undefined && record.screen !== null && record.screen !== "") {
    const parsedScreen = parseBoundedString(
      record.screen,
      "screen",
      BROADCAST_SCREEN_MAX_LENGTH,
    ).toLowerCase();
    if (!SCREEN_FORMAT_RE.test(parsedScreen)) {
      throw new AppError(400, "screen is invalid");
    }
    screen = parsedScreen;
  }

  let emails: string[] | undefined;
  if (record.emails !== undefined) {
    if (!Array.isArray(record.emails)) {
      throw new AppError(400, "emails must be an array of strings");
    }
    if (record.emails.length > BROADCAST_EMAILS_MAX) {
      throw new AppError(
        400,
        `Too many emails (max ${BROADCAST_EMAILS_MAX} per targeted send)`,
      );
    }
    const seen = new Set<string>();
    emails = [];
    for (const value of record.emails) {
      if (typeof value !== "string") {
        throw new AppError(400, "emails must be an array of strings");
      }
      const email = value.trim().toLowerCase();
      if (!email || seen.has(email)) continue;
      if (!EMAIL_FORMAT_RE.test(email)) {
        throw new AppError(400, `Invalid email: ${value}`);
      }
      seen.add(email);
      emails.push(email);
    }
    if (emails.length === 0) {
      throw new AppError(400, "At least one recipient email is required");
    }
  }

  let dedupKey: string | undefined;
  if (
    record.dedupKey !== undefined &&
    record.dedupKey !== null &&
    record.dedupKey !== ""
  ) {
    dedupKey = parseBoundedString(
      record.dedupKey,
      "dedupKey",
      BROADCAST_DEDUP_KEY_MAX_LENGTH,
    );
  }

  return { title, body: bodyText, screen, emails, dedupKey };
}

function emptyPushResult(): PushDeliveryResult {
  return {
    targeted: 0,
    sent: 0,
    failed: 0,
    invalidRegistrationTokens: [],
    errorCodes: [],
  };
}

export async function handlePushBroadcast(
  req: Request,
  res: Response,
): Promise<void> {
  const expected = env.SIGNALS_ALERT_SECRET;
  if (!expected) {
    throw new AppError(503, "Push broadcast webhook not configured");
  }
  if (req.header("x-alert-secret") !== expected) {
    throw new AppError(401, "Invalid alert secret");
  }

  const payload = parseBroadcastPushPayload(req.body);

  let notificationId: string | null = null;
  if (payload.dedupKey) {
    try {
      const created = await PushBroadcastNotification.create({
        dedupKey: payload.dedupKey,
        title: payload.title,
        body: payload.body,
        screen: payload.screen,
      });
      notificationId = String(created._id);
    } catch (err) {
      const isDuplicate =
        typeof err === "object" &&
        err !== null &&
        (err as { code?: number }).code === 11000;
      if (isDuplicate) {
        res.status(200).json({
          status: "already_sent",
          targeted: 0,
          sent: 0,
          failed: 0,
          errorCodes: [],
        });
        return;
      }
      throw err;
    }
  }

  let recipients: PushRecipient[] | undefined;
  let skippedUnknown = 0;
  if (payload.emails) {
    const docs = await User.find({ email: { $in: payload.emails } })
      .select("_id email name")
      .lean();
    const byEmail = new Map<string, PushRecipient>();
    for (const doc of docs) {
      const email = (doc as { email?: string }).email?.trim().toLowerCase();
      const userId = String((doc as { _id?: unknown })._id ?? "");
      if (!email || !userId) continue;
      byEmail.set(email, {
        userId,
        firstName: deriveFirstName((doc as { name?: string | null }).name),
      });
    }
    recipients = [];
    for (const email of payload.emails) {
      const recipient = byEmail.get(email);
      if (!recipient) {
        skippedUnknown++;
        continue;
      }
      recipients.push(recipient);
    }
  }

  let result = emptyPushResult();
  try {
    result = await sendBroadcastPush(
      {
        title: payload.title,
        body: payload.body,
        screen: payload.screen,
      },
      { recipients },
    );
  } catch (pushError) {
    console.error("[push-broadcast] send failed:", pushError);
    result = {
      targeted: 0,
      sent: 0,
      failed: 0,
      invalidRegistrationTokens: [],
      errorCodes: ["send_failed"],
    };
  }

  if (notificationId) {
    await PushBroadcastNotification.findByIdAndUpdate(notificationId, {
      $set: {
        recipientCount: payload.emails?.length ?? result.targeted,
        pushTargetCount: result.targeted,
        pushSentCount: result.sent,
        pushFailedCount: result.failed,
        pushErrorCodes: result.errorCodes,
      },
    });
  }

  console.log(
    `[push-broadcast] title=${JSON.stringify(payload.title)} targeted=${result.targeted} sent=${result.sent} failed=${result.failed} skippedUnknown=${skippedUnknown} errors=${result.errorCodes.join(",") || "none"}`,
  );

  res.status(200).json({
    status: "sent",
    targeted: result.targeted,
    sent: result.sent,
    failed: result.failed,
    errorCodes: result.errorCodes,
    skippedUnknown,
  });
}
