import type { Request, Response } from "express";
import PushInstallation, {
  type PushPlatform,
} from "../models/pushInstallation.model";
import { AppError } from "../middleware/errorHandler";

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
