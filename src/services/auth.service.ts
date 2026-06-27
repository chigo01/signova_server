import User, { IUser } from "../models/user.model";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AUTH_CONSTANTS } from "../config/constants";
import { sendEmail } from "./email/email.service";
import { welcomeEmail } from "./email/templates/welcome";
import { deriveFirstName } from "./email/templates/_shared";
import { ReferralService } from "./referral.service";
import { AppError } from "../middleware/errorHandler";

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
  static async verifyGoogleToken(
    accessToken: string
  ): Promise<{ email: string; name: string; googleId: string }> {
    const expectedAud = env.GOOGLE_CLIENT_ID;
    if (!expectedAud) {
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
    if (!tokenAud || tokenAud !== expectedAud) {
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

    return AuthService.buildGoogleIdentity(tokenInfo, payload, expectedAud);
  }

  /**
   * Pure validation + extraction shared by verifyGoogleToken. Asserts the
   * token's audience matches GOOGLE_CLIENT_ID and that the profile carries a
   * verified email + subject, then returns the proven identity. Kept separate
   * so the audience/identity rules can be unit-tested without network calls.
   */
  static buildGoogleIdentity(
    tokenInfo: GoogleTokenInfo,
    userInfo: GoogleUserInfo,
    expectedAud: string
  ): { email: string; name: string; googleId: string } {
    const aud = tokenInfo.aud ?? tokenInfo.azp;
    if (!aud || aud !== expectedAud) {
      throw new AppError(
        401,
        "Google token was not issued for this application"
      );
    }
    if (!userInfo.email || !userInfo.sub) {
      throw new AppError(401, "Google token is missing identity claims");
    }
    if (userInfo.email_verified === false) {
      throw new AppError(401, "Google email is not verified");
    }

    return {
      email: userInfo.email,
      name: userInfo.name || userInfo.email.split("@")[0],
      googleId: userInfo.sub,
    };
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
}
