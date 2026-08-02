import { Request, Response, NextFunction } from "express";
import { AuthService } from "../services/auth.service";
import { COOKIE_NAME } from "../config/cookie";
import User from "../models/user.model";

export const verifyToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // Check Authorization header first (Bearer token)
  let token: string | undefined;
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7);
  } else {
    // Fallback to cookie for backwards compatibility
    token = req.cookies[COOKIE_NAME];
  }

  if (!token) {
    res.status(401).json({ message: "Unauthorized - No token provided" });
    return;
  }

  // Keep JWT failures separate from database failures. A database outage must
  // not be reported to clients as an expired session.
  let decoded: { userId: string; email: string };
  try {
    decoded = AuthService.verifyToken(token);
  } catch {
    res.status(401).json({ message: "Invalid or expired token" });
    return;
  }

  try {
    // Reject revoked tokens (logout kill switch).
    if (await AuthService.isTokenBlacklisted(token)) {
      res.status(401).json({ message: "Token has been revoked" });
      return;
    }

    // Re-validate identity per request: a token's claims are trusted only while
    // the user still exists. Deleted accounts lose access immediately rather
    // than retaining it until the 7-day token expires (audit H4).
    const userExists = await User.exists({ _id: decoded.userId });
    if (!userExists) {
      res.status(401).json({ message: "Unauthorized - User not found" });
      return;
    }

    req.user = decoded;
    next();
  } catch (error) {
    // Let the central error handler report infrastructure/database failures as
    // 500s. Calling these token failures makes healthy sessions look expired.
    next(error);
  }
};
