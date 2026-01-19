import { Request, Response, NextFunction } from "express";
import { AuthService } from "../services/auth.service";
import { COOKIE_NAME } from "../config/cookie";
import { AppError } from "./errorHandler";

export const verifyToken = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    const token = req.cookies[COOKIE_NAME];

    if (!token) {
      res.status(401).json({ message: "Unauthorized - No token provided" });
      return;
    }

    const decoded = AuthService.verifyToken(token);
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
