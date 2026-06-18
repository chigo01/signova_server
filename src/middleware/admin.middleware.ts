import { Request, Response, NextFunction } from "express";
import { env } from "../config/env";

/**
 * Gate for affiliate admin endpoints. Must run *after* verifyToken (which sets
 * req.user). Allows only users whose email is in the ADMIN_EMAILS allowlist.
 */
export const requireAdmin = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const email = req.user?.email?.trim().toLowerCase();

  if (!email) {
    res.status(401).json({ message: "Unauthorized - No token provided" });
    return;
  }

  if (!env.ADMIN_EMAILS.includes(email)) {
    res.status(403).json({ message: "Forbidden - admin access required" });
    return;
  }

  next();
};
