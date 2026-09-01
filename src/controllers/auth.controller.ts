import { Request, Response } from "express";
import { AppleAuthService } from "../services/apple-auth.service";
import { AuthService } from "../services/auth.service";
import {
  AccountDeletionService,
  DeletionPlatform,
} from "../services/accountDeletion.service";
import { asyncHandler } from "../middleware/asyncHandler";
import { AppError } from "../middleware/errorHandler";
import User from "../models/user.model";
import {
  ACCOUNT_DELETION_CONSTANTS,
  PROFILE_CONSTANTS,
} from "../config/constants";
import { env } from "../config/env";
import { COOKIE_NAME } from "../config/cookie";
import { isValidTimeZone } from "../services/watchlist.service";
import {
  effectivePlan,
  effectiveProExpiry,
} from "../services/planEntitlement.service";

// Notification preference categories. Each maps to a set of emails the user can
// opt out of; transactional mail (OTP, welcome) is intentionally not included.
const NOTIFICATION_PREFERENCE_KEYS = [
  "newSignals",
  "tradeAlerts",
  "newsletter",
] as const;
type NotificationPreferenceKey = (typeof NOTIFICATION_PREFERENCE_KEYS)[number];

function serializeUser(user: {
  _id: unknown;
  email: string;
  name?: string;
  phone?: string;
  username?: string;
  role?: string;
  avatarDataUrl?: string;
  tradeReversalEnabled?: boolean;
  notificationPreferences?: Partial<Record<NotificationPreferenceKey, boolean>>;
  stockNewsPreferences?: {
    delivery?: "off" | "immediate" | "daily";
    timezone?: string;
    changedAt?: Date;
  };
  plan?: "free" | "pro";
  proPlanExpiry?: Date;
  mobileSubscription?: {
    provider: "revenuecat";
    entitlementId: string;
    entitlementActive: boolean;
    productId?: string;
    store?: string;
    environment?: "SANDBOX" | "PRODUCTION";
    status: "active" | "cancelled" | "billing_issue" | "expired";
    expiresAt?: Date;
    willRenew: boolean;
    originalTransactionId?: string;
    lastEventTimestampMs?: number;
    syncedAt: Date;
  };
  balanceUsdMicro?: number;
  deletionRequestedAt?: Date | null;
  deletionScheduledFor?: Date | null;
}) {
  const prefs = user.notificationPreferences ?? {};
  return {
    id: String(user._id),
    revenueCatAppUserId: String(user._id),
    email: user.email,
    name: user.name,
    phone: user.phone,
    username: user.username,
    role: user.role,
    avatarDataUrl: user.avatarDataUrl,
    tradeReversalEnabled: user.tradeReversalEnabled ?? true,
    notificationPreferences: {
      newSignals: prefs.newSignals ?? true,
      tradeAlerts: prefs.tradeAlerts ?? true,
      newsletter: prefs.newsletter ?? true,
    },
    stockNewsPreferences: {
      delivery: user.stockNewsPreferences?.delivery ?? "off",
      timezone: user.stockNewsPreferences?.timezone ?? "UTC",
      changedAt: user.stockNewsPreferences?.changedAt,
    },
    plan: effectivePlan(user),
    proPlanExpiry: effectiveProExpiry(user),
    mobileSubscription: user.mobileSubscription,
    balanceUsdMicro: user.balanceUsdMicro ?? 0,
    // Non-null while the account is inside its deletion grace window. Clients
    // use this to show the "scheduled for deletion — undo?" prompt on login.
    pendingDeletion: AccountDeletionService.deletionState(user),
  };
}

export const sendOtp = asyncHandler(async (req: Request, res: Response) => {
  const { email, name, phone, referralCode } = req.body;

  if (!email) {
    throw new AppError(400, "Email is required");
  }
  if (typeof email !== "string") {
    throw new AppError(400, "Email must be a string");
  }
  const normalizedEmail = email.trim().toLowerCase();
  if (!PROFILE_CONSTANTS.EMAIL_REGEX.test(normalizedEmail)) {
    throw new AppError(400, "Email must be a valid email address");
  }

  let normalizedPhone: string | undefined;
  if (phone !== undefined && phone !== null && phone !== "") {
    if (typeof phone !== "string") {
      throw new AppError(400, "Phone must be a string");
    }
    const trimmed = phone.trim();
    if (trimmed && !PROFILE_CONSTANTS.PHONE_E164_REGEX.test(trimmed)) {
      throw new AppError(
        400,
        "Phone must be a valid E.164 number, e.g. +14155550100"
      );
    }
    normalizedPhone = trimmed || undefined;
  }

  const normalizedReferralCode =
    typeof referralCode === "string" ? referralCode.trim() : undefined;

  await AuthService.sendOTP(
    normalizedEmail,
    name,
    normalizedPhone,
    normalizedReferralCode
  );

  res.status(200).json({ message: "OTP sent successfully" });
});

export const verifyOtp = asyncHandler(async (req: Request, res: Response) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    throw new AppError(400, "Email and OTP are required");
  }
  if (typeof email !== "string") {
    throw new AppError(400, "Email must be a string");
  }

  const user = await AuthService.verifyOTP(email.trim().toLowerCase(), otp);

  if (!user) {
    throw new AppError(400, "Invalid or expired OTP");
  }

  // Generate JWT
  const token = AuthService.generateToken(user._id, user.email);

  // Return token in response body - webapp will save it in a cookie
  res.status(200).json({
    message: "Login successful",
    token,
    user: serializeUser(user),
  });
});

export const googleLogin = asyncHandler(
  async (req: Request, res: Response) => {
    const { id_token, access_token, referralCode } = req.body;
    const idToken =
      typeof id_token === "string" && id_token.trim()
        ? id_token.trim()
        : undefined;
    const accessToken =
      typeof access_token === "string" && access_token.trim()
        ? access_token.trim()
        : undefined;

    if (!idToken && !accessToken) {
      throw new AppError(400, "Google ID token or access token is required");
    }

    const normalizedReferralCode =
      typeof referralCode === "string" ? referralCode.trim() : undefined;

    // Native clients use an ID token. The access-token path remains available
    // for the existing web OAuth flow and is subject to the same audience gate.
    const googleUser = idToken
      ? await AuthService.verifyGoogleIdToken(idToken)
      : await AuthService.verifyGoogleAccessToken(accessToken!);
    const user = await AuthService.findOrCreateGoogleUser(
      googleUser.email,
      googleUser.name,
      googleUser.googleId,
      normalizedReferralCode
    );

    const token = AuthService.generateToken(user._id, user.email);

    res.status(200).json({
      message: "Login successful",
      token,
      user: serializeUser(user),
    });
  }
);

export const appleLogin = asyncHandler(
  async (req: Request, res: Response) => {
    const {
      identity_token,
      authorization_code,
      raw_nonce,
      given_name,
      family_name,
      referralCode,
    } = req.body;
    if (
      typeof identity_token !== "string" ||
      typeof authorization_code !== "string" ||
      typeof raw_nonce !== "string" ||
      !identity_token.trim() ||
      !authorization_code.trim() ||
      !raw_nonce.trim()
    ) {
      throw new AppError(400, "Apple credentials are required");
    }

    const apple = await AppleAuthService.verifyAndExchange({
      identityToken: identity_token.trim(),
      authorizationCode: authorization_code.trim(),
      rawNonce: raw_nonce.trim(),
    });
    const name = [given_name, family_name]
      .filter((value) => typeof value === "string" && value.trim())
      .map((value: string) => value.trim())
      .join(" ")
      .slice(0, 120) || undefined;
    const user = await AuthService.findOrCreateAppleUser(
      apple.appleId,
      apple.email,
      name,
      apple.encryptedRefreshToken,
      typeof referralCode === "string" ? referralCode.trim() : undefined
    );
    const token = AuthService.generateToken(user._id, user.email);

    res.status(200).json({
      message: "Login successful",
      token,
      user: serializeUser(user),
    });
  }
);

export const logout = asyncHandler(async (req: Request, res: Response) => {
  // Revoke the presented token so it can't be reused after logout. The token
  // may arrive as a Bearer header or the auth cookie. Always 200 — logout is
  // best-effort and idempotent even if no token was supplied.
  const authHeader = req.headers.authorization;
  let token: string | undefined;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7);
  } else {
    token = (req.cookies as Record<string, string> | undefined)?.[COOKIE_NAME];
  }

  if (token) {
    await AuthService.blacklistToken(token);
  }

  res.status(200).json({ message: "Logged out successfully" });
});

export const checkAuth = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, "Unauthorized");
  }

  const user = await User.findById(req.user.userId);
  if (!user) {
    throw new AppError(404, "User not found");
  }

  res.status(200).json({
    message: "Authenticated",
    user: serializeUser(user),
  });
});

/**
 * Schedules the account for deletion after the grace window. Required for
 * Google Play's account-deletion policy and App Store guideline 5.1.1(v).
 *
 * Nothing is destroyed here — the account keeps working until the purge job
 * runs, and `POST /auth/account/delete/revoke` cancels it at any point before
 * then. Idempotent: re-requesting returns the original date.
 */
export const requestAccountDeletion = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      throw new AppError(401, "Unauthorized");
    }

    const { reason, platform } = req.body as {
      reason?: unknown;
      platform?: unknown;
    };

    let normalizedReason: string | undefined;
    if (reason !== undefined && reason !== null && reason !== "") {
      if (typeof reason !== "string") {
        throw new AppError(400, "Reason must be a string");
      }
      const trimmed = reason.trim();
      if (trimmed.length > ACCOUNT_DELETION_CONSTANTS.REASON_MAX) {
        throw new AppError(
          400,
          `Reason must be ${ACCOUNT_DELETION_CONSTANTS.REASON_MAX} characters or fewer`
        );
      }
      normalizedReason = trimmed || undefined;
    }

    let normalizedPlatform: DeletionPlatform | undefined;
    if (platform !== undefined && platform !== null && platform !== "") {
      const allowed = ACCOUNT_DELETION_CONSTANTS.PLATFORMS as readonly string[];
      if (typeof platform !== "string" || !allowed.includes(platform)) {
        throw new AppError(400, "Platform is not in the allowed list");
      }
      normalizedPlatform = platform as DeletionPlatform;
    }

    const pendingDeletion = await AccountDeletionService.requestDeletion(
      req.user.userId,
      { reason: normalizedReason, platform: normalizedPlatform }
    );

    res.status(200).json({
      message: "Account scheduled for deletion",
      pendingDeletion,
      graceDays: env.ACCOUNT_DELETION_GRACE_DAYS,
    });
  }
);

/**
 * Cancels a pending deletion. Succeeds whether or not one was outstanding so a
 * double-click is harmless; `revoked` says which happened.
 */
export const revokeAccountDeletion = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      throw new AppError(401, "Unauthorized");
    }

    const { revoked } = await AccountDeletionService.revokeDeletion(
      req.user.userId
    );

    res.status(200).json({
      message: revoked
        ? "Account deletion cancelled"
        : "No pending deletion request",
      revoked,
      pendingDeletion: null,
    });
  }
);

export const updateProfile = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      throw new AppError(401, "Unauthorized");
    }

    const {
      name,
      username,
      role,
      avatarDataUrl,
      tradeReversalEnabled,
      notificationPreferences,
      stockNewsPreferences,
    } = req.body as {
      name?: unknown;
      username?: unknown;
      role?: unknown;
      avatarDataUrl?: unknown;
      tradeReversalEnabled?: unknown;
      notificationPreferences?: unknown;
      stockNewsPreferences?: unknown;
    };

    const updates: Record<string, unknown> = {};

    if (name !== undefined) {
      if (typeof name !== "string") {
        throw new AppError(400, "Name must be a string");
      }
      const trimmed = name.trim();
      if (trimmed.length < 1 || trimmed.length > PROFILE_CONSTANTS.NAME_MAX) {
        throw new AppError(
          400,
          `Name must be between 1 and ${PROFILE_CONSTANTS.NAME_MAX} characters`
        );
      }
      updates.name = trimmed;
    }

    if (username !== undefined) {
      if (username === null || username === "") {
        updates.username = undefined;
      } else {
        if (typeof username !== "string") {
          throw new AppError(400, "Username must be a string");
        }
        const normalized = username.trim().toLowerCase();
        if (!PROFILE_CONSTANTS.USERNAME_REGEX.test(normalized)) {
          throw new AppError(
            400,
            `Username must be ${PROFILE_CONSTANTS.USERNAME_MIN}-${PROFILE_CONSTANTS.USERNAME_MAX} characters using letters, numbers, hyphen, or underscore`
          );
        }
        updates.username = normalized;
      }
    }

    if (role !== undefined) {
      if (role === null || role === "") {
        updates.role = undefined;
      } else {
        if (typeof role !== "string") {
          throw new AppError(400, "Role must be a string");
        }
        const allowed = PROFILE_CONSTANTS.ROLES as readonly string[];
        if (!allowed.includes(role)) {
          throw new AppError(400, "Role is not in the allowed list");
        }
        updates.role = role;
      }
    }

    if (avatarDataUrl !== undefined) {
      if (avatarDataUrl === null || avatarDataUrl === "") {
        updates.avatarDataUrl = undefined;
      } else {
        if (typeof avatarDataUrl !== "string") {
          throw new AppError(400, "Avatar must be a string");
        }
        if (!PROFILE_CONSTANTS.AVATAR_DATA_URI_REGEX.test(avatarDataUrl)) {
          throw new AppError(
            400,
            "Avatar must be a base64 PNG, JPEG, or WEBP data URI"
          );
        }
        if (avatarDataUrl.length > PROFILE_CONSTANTS.AVATAR_MAX_LENGTH) {
          throw new AppError(400, "Avatar is too large");
        }
        updates.avatarDataUrl = avatarDataUrl;
      }
    }

    if (tradeReversalEnabled !== undefined) {
      if (typeof tradeReversalEnabled !== "boolean") {
        throw new AppError(400, "tradeReversalEnabled must be a boolean");
      }
      updates.tradeReversalEnabled = tradeReversalEnabled;
    }

    if (notificationPreferences !== undefined) {
      if (
        typeof notificationPreferences !== "object" ||
        notificationPreferences === null ||
        Array.isArray(notificationPreferences)
      ) {
        throw new AppError(
          400,
          "notificationPreferences must be an object"
        );
      }
      // Apply each provided key with dot notation so a partial PATCH does not
      // clobber the other preference keys already stored on the user.
      for (const [key, value] of Object.entries(notificationPreferences)) {
        if (
          !NOTIFICATION_PREFERENCE_KEYS.includes(
            key as NotificationPreferenceKey
          )
        ) {
          throw new AppError(
            400,
            `Unknown notification preference: ${key}`
          );
        }
        if (typeof value !== "boolean") {
          throw new AppError(
            400,
            `notificationPreferences.${key} must be a boolean`
          );
        }
        updates[`notificationPreferences.${key}`] = value;
      }
    }

    if (stockNewsPreferences !== undefined) {
      if (
        typeof stockNewsPreferences !== "object" ||
        stockNewsPreferences === null ||
        Array.isArray(stockNewsPreferences)
      ) {
        throw new AppError(400, "stockNewsPreferences must be an object");
      }
      const allowed = new Set(["delivery", "timezone"]);
      for (const key of Object.keys(stockNewsPreferences)) {
        if (!allowed.has(key)) {
          throw new AppError(400, `Unknown stock news preference: ${key}`);
        }
      }
      const prefs = stockNewsPreferences as Record<string, unknown>;
      if (prefs.delivery !== undefined) {
        if (
          prefs.delivery !== "off" &&
          prefs.delivery !== "immediate" &&
          prefs.delivery !== "daily"
        ) {
          throw new AppError(400, "Invalid stock news delivery mode");
        }
        updates["stockNewsPreferences.delivery"] = prefs.delivery;
      }
      if (prefs.timezone !== undefined) {
        if (
          typeof prefs.timezone !== "string" ||
          !isValidTimeZone(prefs.timezone)
        ) {
          throw new AppError(400, "Invalid IANA timezone");
        }
        updates["stockNewsPreferences.timezone"] = prefs.timezone;
      }
      if (prefs.delivery !== undefined || prefs.timezone !== undefined) {
        updates["stockNewsPreferences.changedAt"] = new Date();
      }
    }

    if (Object.keys(updates).length === 0) {
      throw new AppError(400, "No valid fields to update");
    }

    try {
      const user = await User.findByIdAndUpdate(req.user.userId, updates, {
        new: true,
        runValidators: true,
      });

      if (!user) {
        throw new AppError(404, "User not found");
      }

      res.status(200).json({
        message: "Profile updated",
        user: serializeUser(user),
      });
    } catch (err: unknown) {
      const error = err as { code?: number; keyPattern?: Record<string, unknown> };
      if (error.code === 11000 && error.keyPattern?.username) {
        throw new AppError(409, "Username taken");
      }
      throw err;
    }
  }
);
