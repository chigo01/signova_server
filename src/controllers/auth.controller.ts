import { Request, Response } from "express";
import { AuthService } from "../services/auth.service";
import { asyncHandler } from "../middleware/asyncHandler";
import { AppError } from "../middleware/errorHandler";
import User from "../models/user.model";
import { PROFILE_CONSTANTS } from "../config/constants";

// Notification preference categories. Each maps to a set of emails the user can
// opt out of; transactional mail (OTP, welcome) is intentionally not included.
const NOTIFICATION_PREFERENCE_KEYS = [
  "newSignals",
  "tradeAlerts",
  "newsletter",
] as const;
type NotificationPreferenceKey = (typeof NOTIFICATION_PREFERENCE_KEYS)[number];

function serializeUser(user: {
  email: string;
  name?: string;
  phone?: string;
  username?: string;
  role?: string;
  avatarDataUrl?: string;
  tradeReversalEnabled?: boolean;
  notificationPreferences?: Partial<Record<NotificationPreferenceKey, boolean>>;
  plan?: "free" | "pro";
  proPlanExpiry?: Date;
  balanceUsdMicro?: number;
}) {
  const prefs = user.notificationPreferences ?? {};
  return {
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
    plan: user.plan ?? "free",
    proPlanExpiry: user.proPlanExpiry,
    balanceUsdMicro: user.balanceUsdMicro ?? 0,
  };
}

export const sendOtp = asyncHandler(async (req: Request, res: Response) => {
  const { email, name, phone } = req.body;

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

  await AuthService.sendOTP(normalizedEmail, name, normalizedPhone);

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
    const { access_token } = req.body;

    if (!access_token) {
      throw new AppError(400, "Google access token is required");
    }

    const googleUser = await AuthService.verifyGoogleToken(access_token);
    const user = await AuthService.findOrCreateGoogleUser(
      googleUser.email,
      googleUser.name,
      googleUser.googleId
    );

    const token = AuthService.generateToken(user._id, user.email);

    res.status(200).json({
      message: "Login successful",
      token,
      user: serializeUser(user),
    });
  }
);

export const logout = (_req: Request, res: Response) => {
  // Cookie is now managed client-side, just return success
  res.status(200).json({ message: "Logged out successfully" });
};

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
    } = req.body as {
      name?: unknown;
      username?: unknown;
      role?: unknown;
      avatarDataUrl?: unknown;
      tradeReversalEnabled?: unknown;
      notificationPreferences?: unknown;
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
