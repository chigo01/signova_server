import { Request, Response, NextFunction } from "express";
import { AuthService } from "../services/auth.service";
import { COOKIE_NAME } from "../config/cookie";
import { AppError } from "./errorHandler";
import User from "../models/user.model";

export const verifyToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
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

    // Reject revoked tokens (logout kill switch) before trusting the claims.
    if (await AuthService.isTokenBlacklisted(token)) {
      res.status(401).json({ message: "Token has been revoked" });
      return;
    }

    const decoded = AuthService.verifyToken(token);

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
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ message: error.message });
      return;
    }
    res.status(403).json({ message: "Invalid or expired token" });
    return;
  }
};
