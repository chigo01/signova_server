import User, { IUser } from "../models/user.model";
import TokenBlacklist from "../models/tokenBlacklist.model";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AUTH_CONSTANTS } from "../config/constants";
import { sendEmail } from "./email/email.service";
import { welcomeEmail } from "./email/templates/welcome";
import { deriveFirstName } from "./email/templates/_shared";
import { ReferralService } from "./referral.service";
import { AppError } from "../middleware/errorHandler";
import { OAuth2Client, TokenPayload } from "google-auth-library";

/** Subset of Google's tokeninfo response we rely on. */
export interface GoogleTokenInfo {
  aud?: string;
  azp?: string;
  expires_in?: string;
  email_verified?: string | boolean;
}

/** Subset of Google's userinfo (oauth2/v3) response we rely on. */
export interface GoogleUserInfo {
  email?: string;
  email_verified?: boolean;
  name?: string;
  sub?: string;
}

export class AuthService {
  private static readonly googleOAuthClient = new OAuth2Client();

  private static isTestOtpEmail(normalizedEmail: string): boolean {
    return (
      env.testOtpBypassEnabled &&
      normalizedEmail === env.testOtpEmail &&
      !!env.testOtpCode
    );
  }

  /**
   * Generate a 6-digit OTP
   */
  static generateOTP(): string {
    return Math.floor(
      100000 + Math.random() * 900000
    ).toString();
  }

  /**
   * Send OTP to user's email and save to database
   */
  static async sendOTP(
    email: string,
    name?: string,
    phone?: string,
    referralCode?: string
  ): Promise<void> {
    const normalized = email.trim().toLowerCase();
    const testBypass = this.isTestOtpEmail(normalized);
    const lookupEmail = normalized;
    const otp = testBypass ? env.testOtpCode! : this.generateOTP();
    const otpExpiry = new Date(
      Date.now() + AUTH_CONSTANTS.OTP_EXPIRY_MINUTES * 60 * 1000
    );

    // Find or create user and update OTP
    let user = await User.findOne({ email: lookupEmail });
    const isNewUser = !user;
    if (!user) {
      const code = await ReferralService.generateReferralCode();
      user = new User({
        email: lookupEmail,
        name,
        phone,
        otp,
        otpExpiry,
        referralCode: code,
      });
    } else {
      user.otp = otp;
      user.otpExpiry = otpExpiry;
      if (name) user.name = name;
      if (phone) user.phone = phone;
    }
    await user.save();

    // Link the new user to their referrer (no-op for unknown/invalid codes).
    if (isNewUser) {
      await ReferralService.attachReferrer(user, referralCode);
    }

    if (testBypass) {
      console.log(`[TEST OTP] Fixed OTP for ${lookupEmail} (email not sent)`);
      return;
    }

    await this.sendOTPEmail(lookupEmail, otp);
  }

  /**
   * Send OTP email using Resend API
   */
  private static async sendOTPEmail(
    email: string,
    otp: string
  ): Promise<void> {
    if (!env.RESEND_API_KEY) {
      console.log(`[DEV ONLY] OTP for ${email}: ${otp}`);
      return;
    }

    await sendEmail({
      to: email,
      subject: "Your Signova Login Code",
      html: `<p>Your code is <strong>${otp}</strong></p>`,
    });
  }

  /**
   * Send the beta Welcome email exactly once per user (first sign-up confirmation).
   * Fire-and-forget: errors are logged but never block auth flow.
   */
  private static async maybeSendWelcomeEmail(user: IUser): Promise<void> {
    if (user.welcomedAt) return;
    user.welcomedAt = new Date();
    try {
      await user.save();
    } catch (saveErr) {
      console.error("Welcome email: failed to persist welcomedAt", saveErr);
      return;
    }

    // First verified login: award the referrer their signup bonus exactly once.
    await ReferralService.creditReferralSignup(user);

    try {
      const { subject, html } = welcomeEmail({
        firstName: deriveFirstName(user.name),
      });
      await sendEmail({ to: user.email, subject, html });
    } catch (err) {
      console.error("Welcome email: send failed", err);
    }
  }

  /**
   * Verify OTP and return user if valid
   */
  static async verifyOTP(
    email: string,
    otp: string
  ): Promise<{
    _id: any;
    email: string;
    name?: string;
    phone?: string;
    plan: "free" | "pro";
    proPlanExpiry?: Date;
    balanceUsdMicro: number;
  } | null> {
    const normalized = email.trim().toLowerCase();
    const otpNorm = String(otp ?? "").trim();
    if (this.isTestOtpEmail(normalized) && otpNorm === env.testOtpCode) {
      let user = await User.findOne({ email: normalized });
      if (!user) {
        user = await new User({ email: normalized }).save();
      } else {
        user.otp = undefined;
        user.otpExpiry = undefined;
        await user.save();
      }

      await this.maybeSendWelcomeEmail(user);

      return {
        _id: user._id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        plan: user.plan,
        proPlanExpiry: user.proPlanExpiry,
        balanceUsdMicro: user.balanceUsdMicro,
      };
    }

    const user = await User.findOne({ email: normalized });

    if (
      !user ||
      user.otp !== otpNorm ||
      !user.otpExpiry ||
      user.otpExpiry < new Date()
    ) {
      return null;
    }

    user.otp = undefined;
    user.otpExpiry = undefined;
    await user.save();

    await this.maybeSendWelcomeEmail(user);

    return {
      _id: user._id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      plan: user.plan,
      proPlanExpiry: user.proPlanExpiry,
      balanceUsdMicro: user.balanceUsdMicro,
    };
  }

  /**
   * Verify a Google access token and return the proven identity.
   *
   * The access token's audience (`aud` / `azp` — the OAuth client id it was
   * minted for) is verified against GOOGLE_CLIENT_ID via Google's tokeninfo
   * endpoint BEFORE the userinfo profile is trusted. Without this check, any
   * valid Google access token — including one issued for a *different* OAuth
   * app — yields a valid userinfo response, letting an attacker who obtains a
   * victim's token for an unrelated app log in as that victim (audit C2).
   *
   * userinfo alone cannot do this: it does not return the audience, which is
   * exactly the claim that proves the token was issued for Signova.
   */
  static async verifyGoogleAccessToken(
    accessToken: string
  ): Promise<{ email: string; name: string; googleId: string }> {
    const expectedAudiences = env.GOOGLE_CLIENT_IDS;
    if (expectedAudiences.length === 0) {
      // Fail closed: with no configured client id we cannot prove the token was
      // issued for Signova, so we must not trust any token.
      throw new AppError(503, "Google login is not configured");
    }

    // 1. Verify the token's audience.
    const tokenInfoRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(
        accessToken
      )}`
    );
    if (!tokenInfoRes.ok) {
      throw new AppError(401, "Invalid Google token");
    }
    const tokenInfo = (await tokenInfoRes.json()) as GoogleTokenInfo;
    const tokenAud = tokenInfo.aud ?? tokenInfo.azp;
    if (!AuthService.isAllowedGoogleAudience(tokenAud, expectedAudiences)) {
      throw new AppError(
        401,
        "Google token was not issued for this application"
      );
    }

    // 2. Audience proven — fetch the profile (name/email/sub) from userinfo.
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new AppError(401, "Invalid Google token");
    }

    const payload = (await res.json()) as GoogleUserInfo;

    return AuthService.buildGoogleIdentity(
      tokenInfo,
      payload,
      expectedAudiences
    );
  }

  /**
   * Verify the OpenID Connect ID token returned by a native Google Sign-In.
   *
   * verifyIdToken validates Google's signature, issuer, expiry and audience.
   * Native apps request the token for Signova's web/server OAuth client, which
   * gives Android and iOS one stable backend audience.
   */
  static async verifyGoogleIdToken(
    idToken: string
  ): Promise<{ email: string; name: string; googleId: string }> {
    const expectedAudiences = env.GOOGLE_CLIENT_IDS;
    if (expectedAudiences.length === 0) {
      throw new AppError(503, "Google login is not configured");
    }

    try {
      const ticket = await AuthService.googleOAuthClient.verifyIdToken({
        idToken,
        audience: expectedAudiences,
      });
      const payload = ticket.getPayload();
      if (!payload) {
        throw new AppError(401, "Google token is missing identity claims");
      }
      return AuthService.buildGoogleIdTokenIdentity(
        payload,
        expectedAudiences
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(401, "Invalid Google ID token");
    }
  }

  /**
   * Pure validation + extraction shared by verifyGoogleAccessToken. Asserts
   * that the audience is allowlisted and the profile carries a verified email
   * and subject. Kept separate for network-independent security tests.
   */
  static buildGoogleIdentity(
    tokenInfo: GoogleTokenInfo,
    userInfo: GoogleUserInfo,
    expectedAudiences: string | readonly string[]
  ): { email: string; name: string; googleId: string } {
    const aud = tokenInfo.aud ?? tokenInfo.azp;
    if (!AuthService.isAllowedGoogleAudience(aud, expectedAudiences)) {
      throw new AppError(
        401,
        "Google token was not issued for this application"
      );
    }
    if (!userInfo.email || !userInfo.sub) {
      throw new AppError(401, "Google token is missing identity claims");
    }
    if (userInfo.email_verified !== true) {
      throw new AppError(401, "Google email is not verified");
    }

    return {
      email: userInfo.email.trim().toLowerCase(),
      name: userInfo.name || userInfo.email.split("@")[0],
      googleId: userInfo.sub,
    };
  }

  static buildGoogleIdTokenIdentity(
    payload: TokenPayload,
    expectedAudiences: string | readonly string[]
  ): { email: string; name: string; googleId: string } {
    if (
      !AuthService.isAllowedGoogleAudience(payload.aud, expectedAudiences)
    ) {
      throw new AppError(
        401,
        "Google token was not issued for this application"
      );
    }
    if (!payload.email || !payload.sub) {
      throw new AppError(401, "Google token is missing identity claims");
    }
    if (payload.email_verified !== true) {
      throw new AppError(401, "Google email is not verified");
    }

    return {
      email: payload.email.trim().toLowerCase(),
      name: payload.name || payload.email.split("@")[0],
      googleId: payload.sub,
    };
  }

  private static isAllowedGoogleAudience(
    audience: string | undefined,
    expectedAudiences: string | readonly string[]
  ): boolean {
    if (!audience) return false;
    const allowed = Array.isArray(expectedAudiences)
      ? expectedAudiences
      : [expectedAudiences];
    return allowed.includes(audience);
  }

  /**
   * Find or create a user from Google login (links by email)
   */
  static async findOrCreateGoogleUser(
    email: string,
    name: string,
    googleId: string,
    referralCode?: string
  ): Promise<{
    _id: any;
    email: string;
    name?: string;
    phone?: string;
    plan: "free" | "pro";
    proPlanExpiry?: Date;
    balanceUsdMicro: number;
  }> {
    const normalizedEmail = email.trim().toLowerCase();
    let user = await User.findOne({ email: normalizedEmail });

    if (user) {
      if (!user.googleId) {
        user.googleId = googleId;
        if (!user.name && name) user.name = name;
        await user.save();
      }
    } else {
      const code = await ReferralService.generateReferralCode();
      user = await new User({
        email: normalizedEmail,
        name,
        googleId,
        referralCode: code,
      }).save();
      await ReferralService.attachReferrer(user, referralCode);
    }

    await this.maybeSendWelcomeEmail(user);

    return {
      _id: user._id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      plan: user.plan,
      proPlanExpiry: user.proPlanExpiry,
      balanceUsdMicro: user.balanceUsdMicro,
    };
  }

  static async findOrCreateAppleUser(
    appleId: string,
    email: string | undefined,
    name: string | undefined,
    encryptedRefreshToken: string | undefined,
    referralCode?: string
  ): Promise<{
    _id: any;
    email: string;
    name?: string;
    phone?: string;
    plan: "free" | "pro";
    proPlanExpiry?: Date;
    balanceUsdMicro: number;
  }> {
    const normalizedEmail = email?.trim().toLowerCase();
    let user = await User.findOne({ appleId }).select(
      "+appleRefreshTokenEncrypted"
    );

    if (!user && normalizedEmail) {
      user = await User.findOne({ email: normalizedEmail }).select(
        "+appleRefreshTokenEncrypted"
      );
    }
    if (!user && !normalizedEmail) {
      throw new AppError(
        400,
        "Apple did not provide an email for this new account"
      );
    }

    if (user) {
      if (user.appleId && user.appleId !== appleId) {
        throw new AppError(
          409,
          "This email is already linked to another Apple account"
        );
      }
      let changed = false;
      if (!user.appleId) {
        user.appleId = appleId;
        changed = true;
      }
      if (!user.name && name) {
        user.name = name;
        changed = true;
      }
      if (encryptedRefreshToken) {
        user.appleRefreshTokenEncrypted = encryptedRefreshToken;
        changed = true;
      }
      if (changed) await user.save();
    } else {
      const code = await ReferralService.generateReferralCode();
      user = await new User({
        email: normalizedEmail,
        name: name || normalizedEmail!.split("@")[0],
        appleId,
        appleRefreshTokenEncrypted: encryptedRefreshToken,
        referralCode: code,
      }).save();
      await ReferralService.attachReferrer(user, referralCode);
    }

    await this.maybeSendWelcomeEmail(user);
    return {
      _id: user._id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      plan: user.plan,
      proPlanExpiry: user.proPlanExpiry,
      balanceUsdMicro: user.balanceUsdMicro,
    };
  }

  /**
   * Generate JWT token for authenticated user
   */
  static generateToken(userId: any, email: string): string {
    return jwt.sign({ userId, email }, env.JWT_SECRET, {
      expiresIn: AUTH_CONSTANTS.JWT_EXPIRY,
    });
  }

  /**
   * Verify JWT token and return decoded payload
   */
  static verifyToken(token: string): { userId: string; email: string } {
    return jwt.verify(token, env.JWT_SECRET) as {
      userId: string;
      email: string;
    };
  }

  /**
   * Expiry instant of a JWT (from its `exp` claim). Falls back to the standard
   * token lifetime when the claim can't be read, so a blacklisted token is
   * always retained at least until it would have expired.
   */
  static getTokenExpiry(token: string): Date {
    try {
      const decoded = jwt.decode(token) as { exp?: number } | null;
      if (decoded?.exp) {
        return new Date(decoded.exp * 1000);
      }
    } catch {
      // fall through to default
    }
    return new Date(Date.now() + AUTH_CONSTANTS.JWT_EXPIRY_MS);
  }

  /**
   * Revoke a token (logout). Idempotent: re-revoking an already-blacklisted
   * token is a no-op rather than an error.
   */
  static async blacklistToken(token: string): Promise<void> {
    const expiresAt = this.getTokenExpiry(token);
    await TokenBlacklist.updateOne(
      { token },
      { $setOnInsert: { token, expiresAt } },
      { upsert: true }
    );
  }

  /**
   * True if the token has been revoked and is still within its lifetime.
   */
  static async isTokenBlacklisted(token: string): Promise<boolean> {
    const found = await TokenBlacklist.exists({ token });
    return found != null;
  }
}
