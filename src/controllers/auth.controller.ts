import { Request, Response } from "express";
import User from "../models/user.model";
import { Resend } from "resend";
import jwt from "jsonwebtoken";

const resend = new Resend(process.env.RESEND_API_KEY);

// Helper to generate 6-digit OTP
const generateOTP = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

export const sendOtp = async (req: Request, res: Response) => {
  try {
    const { email, name } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry

    // Find or create user and update OTP
    let user = await User.findOne({ email });
    if (!user) {
      // If registering, name might be provided
      user = new User({ email, name, otp, otpExpiry });
    } else {
      user.otp = otp;
      user.otpExpiry = otpExpiry;
      if (name) user.name = name; // Update name if provided
    }
    await user.save();

    // Send email via Resend
    // NOTE: In development/without a verified domain, you can only send to yourself using Resend's onboarding
    // For now, logging OTP to console for dev purposes if no key provided or failure
    if (process.env.RESEND_API_KEY) {
      try {
        await resend.emails.send({
          from: "noreply@signova.app", // Use your verified domain in prod
          to: email,
          subject: "Your Signova Login Code",
          html: `<p>Your code is <strong>${otp}</strong></p>`,
        });
      } catch (emailError) {
        console.error("Resend Error:", emailError);
        // Fallback for dev: log it
        console.log(`[DEV ONLY] OTP for ${email}: ${otp}`);
      }
    } else {
      console.log(`[DEV ONLY] OTP for ${email}: ${otp}`);
    }

    return res.status(200).json({ message: "OTP sent successfully" });
  } catch (error) {
    console.error("Send OTP Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const verifyOtp = async (req: Request, res: Response) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP are required" });
    }

    const user = await User.findOne({ email });

    if (
      !user ||
      user.otp !== otp ||
      !user.otpExpiry ||
      user.otpExpiry < new Date()
    ) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    // Clear OTP after successful verify
    user.otp = undefined;
    user.otpExpiry = undefined;
    await user.save();

    // Generate JWT
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET || "dev_secret",
      {
        expiresIn: "7d",
      }
    );

    // Set HTTP-only cookie
    res.cookie("auth_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production", // Secure in prod
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax", // "none" for cross-origin in prod
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    return res.status(200).json({
      message: "Login successful",
      user: { email: user.email, name: user.name },
    });
  } catch (error) {
    console.error("Verify OTP Error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export const logout = (_req: Request, res: Response) => {
  res.clearCookie("auth_token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  });
  res.status(200).json({ message: "Logged out successfully" });
};

export const checkAuth = async (req: Request, res: Response) => {
  // This is a protected route example to check if user is logged in
  // You'd typically use middleware to verify the token, here just echoing for simplicity of the check
  // If middleware passed, req.user would be populated
  res.status(200).json({ message: "Authenticated", user: (req as any).user });
};
