import { Request, Response, NextFunction } from "express";

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// In-memory storage for rate limiting.
// NOTE: per-instance only — for multi-instance horizontal scaling this must move
// to a shared store (e.g. Redis). Mirrors admin-server's rateLimitMiddleware so
// both servers stay consistent ahead of extracting a shared package.
const rateLimitStore: Map<string, RateLimitEntry> = new Map();

// Cleanup expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetTime < now) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Create a rate limiter middleware keyed by request email (falling back to IP).
 */
const createRateLimiter = (
  maxRequests: number,
  windowMs: number,
  keyPrefix: string
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const email =
      (typeof req.body?.email === "string" && req.body.email.toLowerCase()) ||
      req.ip;
    const key = `${keyPrefix}:${email}`;
    const now = Date.now();

    const entry = rateLimitStore.get(key);

    if (!entry || entry.resetTime < now) {
      rateLimitStore.set(key, {
        count: 1,
        resetTime: now + windowMs,
      });
      return next();
    }

    if (entry.count >= maxRequests) {
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
      return res.status(429).json({
        success: false,
        message: "Too many requests. Please try again later.",
        retryAfter,
      });
    }

    entry.count += 1;
    return next();
  };
};

// OTP request rate limiter: max 5 requests per 15 minutes per email
export const otpRequestLimiter = createRateLimiter(
  5,
  15 * 60 * 1000,
  "otp-request"
);

// OTP verification rate limiter: max 10 attempts per 15 minutes per email
export const otpVerifyLimiter = createRateLimiter(
  10,
  15 * 60 * 1000,
  "otp-verify"
);

// Social credentials still trigger provider verification and account lookup.
export const socialAuthLimiter = createRateLimiter(
  20,
  15 * 60 * 1000,
  "social-auth"
);

// Watchlist mutations can trigger provider validation and should not be an
// unbounded ticker-probing endpoint.
export const watchlistMutationLimiter = createRateLimiter(
  30,
  60 * 1000,
  "watchlist-mutation",
);
