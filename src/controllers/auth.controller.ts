import { Request, Response } from "express";
import { AuthService } from "../services/auth.service";
import { asyncHandler } from "../middleware/asyncHandler";
import { AppError } from "../middleware/errorHandler";

export const sendOtp = asyncHandler(async (req: Request, res: Response) => {
  const { email, name } = req.body;

  if (!email) {
    throw new AppError(400, "Email is required");
  }

  await AuthService.sendOTP(email, name);

  res.status(200).json({ message: "OTP sent successfully" });
});

export const verifyOtp = asyncHandler(async (req: Request, res: Response) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    throw new AppError(400, "Email and OTP are required");
  }

  const user = await AuthService.verifyOTP(email, otp);

  if (!user) {
    throw new AppError(400, "Invalid or expired OTP");
  }

  // Generate JWT
  const token = AuthService.generateToken(user._id, user.email);

  // Return token in response body - webapp will save it in a cookie
  res.status(200).json({
    message: "Login successful",
    token,
    user: { email: user.email, name: user.name },
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
      user: { email: user.email, name: user.name },
    });
  }
);

export const logout = (_req: Request, res: Response) => {
  // Cookie is now managed client-side, just return success
  res.status(200).json({ message: "Logged out successfully" });
};

export const checkAuth = (req: Request, res: Response) => {
  res.status(200).json({ message: "Authenticated", user: req.user });
};
