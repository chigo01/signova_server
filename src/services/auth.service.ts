import User, { IUser } from "../models/user.model";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AUTH_CONSTANTS } from "../config/constants";
import { sendEmail } from "./email/email.service";
import { welcomeEmail } from "./email/templates/welcome";
import { deriveFirstName } from "./email/templates/_shared";

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
    phone?: string
  ): Promise<void> {
    const normalized = email.trim().toLowerCase();
    const testBypass = this.isTestOtpEmail(normalized);
    const lookupEmail = testBypass ? normalized : email.trim();
    const otp = testBypass ? env.testOtpCode! : this.generateOTP();
    const otpExpiry = new Date(
      Date.now() + AUTH_CONSTANTS.OTP_EXPIRY_MINUTES * 60 * 1000
    );

    // Find or create user and update OTP
    let user = await User.findOne({ email: lookupEmail });
    if (!user) {
      user = new User({ email: lookupEmail, name, phone, otp, otpExpiry });
    } else {
      user.otp = otp;
      user.otpExpiry = otpExpiry;
      if (name) user.name = name;
      if (phone) user.phone = phone;
    }
    await user.save();

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

    const user = await User.findOne({ email });

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
   * Verify Google access token via Google's userinfo endpoint
   */
  static async verifyGoogleToken(
    accessToken: string
  ): Promise<{ email: string; name: string; googleId: string }> {
    const res = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!res.ok) {
      throw new Error("Invalid Google token");
    }

    const payload = await res.json();

    return {
      email: payload.email,
      name: payload.name || payload.email.split("@")[0],
      googleId: payload.sub,
    };
  }

  /**
   * Find or create a user from Google login (links by email)
   */
  static async findOrCreateGoogleUser(
    email: string,
    name: string,
    googleId: string
  ): Promise<{
    _id: any;
    email: string;
    name?: string;
    phone?: string;
    plan: "free" | "pro";
    proPlanExpiry?: Date;
    balanceUsdMicro: number;
  }> {
    let user = await User.findOne({ email });

    if (user) {
      if (!user.googleId) {
        user.googleId = googleId;
        if (!user.name && name) user.name = name;
        await user.save();
      }
    } else {
      user = await new User({ email, name, googleId }).save();
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
