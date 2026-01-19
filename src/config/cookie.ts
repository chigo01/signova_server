import { CookieOptions } from "express";
import { env } from "./env";
import { AUTH_CONSTANTS } from "./constants";

export const getCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: env.NODE_ENV === "production" ? "none" : "lax",
  maxAge: AUTH_CONSTANTS.JWT_EXPIRY_MS,
});

export const COOKIE_NAME = "auth_token";
