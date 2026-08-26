import { createHmac, randomBytes, randomInt } from "node:crypto";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { env } from "../config/env";
import { AppError } from "../middleware/errorHandler";
import { constantTimeSecretMatch } from "../middleware/webinar.middleware";
import WebinarDraw, {
  IWebinarDraw,
  WebinarWinner,
} from "../models/webinarDraw.model";
import WebinarRegistration, {
  IWebinarRegistration,
  WEBINAR_EVENT_KEY,
} from "../models/webinarRegistration.model";
import { sendEmail } from "./email/email.service";
import {
  webinarConfirmationEmail,
  webinarInternalNotificationEmail,
  webinarReminderEmail,
} from "./email/templates/webinar";

export const RAFFLE_TOKEN_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const RAFFLE_WINNER_COUNT = 6;
/** Saturday 29 Aug 2026, 12:00 PM WAT. */
export const WEBINAR_START_AT = new Date("2026-08-29T11:00:00.000Z");
export const WEBINAR_REMINDER_LEAD_MS = 30 * 60 * 1000;
const TOKEN_CREATE_ATTEMPTS = 10;
const ADMIN_SESSION_SECONDS = 4 * 60 * 60;

export type WebinarAttribution = {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  referrer?: string;
  landingUrl?: string;
};

export type WebinarRegistrationInput = {
  name: string;
  email: string;
  phone: string;
  attribution: WebinarAttribution;
};

type PublicWinner = {
  registrationId: string;
  token: string;
  name: string;
  email: string;
  phone: string;
};

export type RaffleSummary = {
  registeredCount: number;
  eligibleCount: number;
  failedConfirmationCount: number;
  canDraw: boolean;
  drawStatus: "not_started" | "pending" | "complete";
  draw: null | {
    drawnAt: string;
    cutoffAt: string;
    eligibleCount: number;
    winners: PublicWinner[];
  };
};

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanString(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, maxLength)
    : "";
}

function cleanOptional(value: unknown, maxLength: number): string | undefined {
  const cleaned = cleanString(value, maxLength);
  return cleaned || undefined;
}

export function normalizeWebinarRegistration(
  input: unknown
): WebinarRegistrationInput {
  const body = asRecord(input);
  const name = cleanString(body.name, 80);
  const email = cleanString(body.email, 254).toLowerCase();
  const phone = cleanString(body.phone, 30);
  const rawAttribution = asRecord(body.attribution);

  if (name.length < 2) throw new AppError(422, "Enter your full name");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new AppError(422, "Enter a valid email address");
  }

  const phoneDigits = phone.replace(/\D/g, "");
  if (
    !/^[+\d\s().-]+$/.test(phone) ||
    phoneDigits.length < 7 ||
    phoneDigits.length > 15
  ) {
    throw new AppError(422, "Enter a valid WhatsApp or phone number");
  }

  return {
    name,
    email,
    phone,
    attribution: {
      utmSource: cleanOptional(rawAttribution.utmSource, 120),
      utmMedium: cleanOptional(rawAttribution.utmMedium, 120),
      utmCampaign: cleanOptional(rawAttribution.utmCampaign, 160),
      utmContent: cleanOptional(rawAttribution.utmContent, 160),
      utmTerm: cleanOptional(rawAttribution.utmTerm, 160),
      referrer: cleanOptional(rawAttribution.referrer, 500),
      landingUrl: cleanOptional(rawAttribution.landingUrl, 500),
    },
  };
}

export function generateRaffleToken(
  randomIndex: (max: number) => number = randomInt
): string {
  let suffix = "";
  for (let index = 0; index < 4; index += 1) {
    suffix += RAFFLE_TOKEN_ALPHABET[randomIndex(RAFFLE_TOKEN_ALPHABET.length)];
  }
  return `SIG-${suffix}`;
}

export function isValidMeetUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "meet.google.com" &&
      !url.username &&
      !url.password &&
      !url.port &&
      /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function requiredEmailConfig(): {
  meetUrl: string;
  notifyEmail: string;
  fromEmail: string;
} {
  if (
    !env.RESEND_API_KEY ||
    !isValidMeetUrl(env.WEBINAR_MEET_URL) ||
    !env.WEBINAR_NOTIFY_EMAIL
  ) {
    throw new AppError(503, "Webinar email service is not configured");
  }

  return {
    meetUrl: env.WEBINAR_MEET_URL!,
    notifyEmail: env.WEBINAR_NOTIFY_EMAIL,
    fromEmail: env.WEBINAR_FROM_EMAIL || "Signova <notification@signova.app>",
  };
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: number }).code === 11000
  );
}

async function findOrCreateRegistration(
  input: WebinarRegistrationInput
): Promise<{ registration: IWebinarRegistration; created: boolean }> {
  const existing = await WebinarRegistration.findOne({
    eventKey: WEBINAR_EVENT_KEY,
    emailNormalized: input.email,
  });
  if (existing) return { registration: existing, created: false };

  for (let attempt = 0; attempt < TOKEN_CREATE_ATTEMPTS; attempt += 1) {
    try {
      const registration = await WebinarRegistration.create({
        eventKey: WEBINAR_EVENT_KEY,
        token: generateRaffleToken(),
        name: input.name,
        email: input.email,
        emailNormalized: input.email,
        phone: input.phone,
        attribution: Object.fromEntries(
          Object.entries(input.attribution).filter(([, value]) => value)
        ),
      });
      return { registration, created: true };
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const racedRegistration = await WebinarRegistration.findOne({
        eventKey: WEBINAR_EVENT_KEY,
        emailNormalized: input.email,
      });
      if (racedRegistration) {
        return { registration: racedRegistration, created: false };
      }
    }
  }

  throw new AppError(503, "Could not allocate a raffle token");
}

function sanitizedEmailError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Email send failed";
  return message.replace(/[\r\n]+/g, " ").slice(0, 300);
}

async function sendConfirmation(
  registration: IWebinarRegistration,
  config: ReturnType<typeof requiredEmailConfig>
): Promise<boolean> {
  const attemptedAt = new Date();
  try {
    await sendEmail({
      to: registration.email,
      from: config.fromEmail,
      subject: "Your webinar spot and raffle token",
      html: webinarConfirmationEmail({
        name: registration.name,
        token: registration.token,
        meetUrl: config.meetUrl,
      }),
    });

    await WebinarRegistration.updateOne(
      { _id: registration._id },
      {
        $set: {
          confirmationStatus: "sent",
          confirmationSentAt: registration.confirmationSentAt || attemptedAt,
          lastConfirmationAttemptAt: attemptedAt,
        },
        $unset: { lastConfirmationError: "" },
      }
    );
    return true;
  } catch (error) {
    await WebinarRegistration.updateOne(
      { _id: registration._id },
      {
        $set: {
          confirmationStatus: registration.confirmationSentAt ? "sent" : "failed",
          lastConfirmationAttemptAt: attemptedAt,
          lastConfirmationError: sanitizedEmailError(error),
        },
      }
    );
    return Boolean(registration.confirmationSentAt);
  }
}

async function sendInternalNotification(
  registration: IWebinarRegistration,
  config: ReturnType<typeof requiredEmailConfig>
): Promise<void> {
  try {
    await sendEmail({
      to: config.notifyEmail,
      from: config.fromEmail,
      replyTo: registration.email,
      subject: `New webinar registration: ${registration.name}`,
      html: webinarInternalNotificationEmail({
        name: registration.name,
        email: registration.email,
        phone: registration.phone,
        token: registration.token,
        attribution: registration.attribution,
      }),
    });
    await WebinarRegistration.updateOne(
      { _id: registration._id },
      {
        $set: {
          internalNotificationStatus: "sent",
          internalNotificationSentAt: new Date(),
        },
        $unset: { lastInternalNotificationError: "" },
      }
    );
  } catch (error) {
    await WebinarRegistration.updateOne(
      { _id: registration._id },
      {
        $set: {
          internalNotificationStatus: "failed",
          lastInternalNotificationError: sanitizedEmailError(error),
        },
      }
    );
  }
}

export function isWebinarReminderWindow(now: Date = new Date()): boolean {
  const start = WEBINAR_START_AT.getTime();
  const open = start - WEBINAR_REMINDER_LEAD_MS;
  const time = now.getTime();
  return time >= open && time < start;
}

async function sendReminder(
  registration: IWebinarRegistration,
  config: ReturnType<typeof requiredEmailConfig>
): Promise<boolean> {
  const attemptedAt = new Date();
  try {
    await sendEmail({
      to: registration.email,
      from: config.fromEmail,
      subject: "Starting in 30 minutes — join the SIGNOVA webinar",
      html: webinarReminderEmail({
        name: registration.name,
        token: registration.token,
        meetUrl: config.meetUrl,
      }),
    });
    await WebinarRegistration.updateOne(
      { _id: registration._id },
      {
        $set: {
          reminderStatus: "sent",
          reminderSentAt: registration.reminderSentAt || attemptedAt,
          lastReminderAttemptAt: attemptedAt,
        },
        $unset: { lastReminderError: "" },
      }
    );
    return true;
  } catch (error) {
    await WebinarRegistration.updateOne(
      { _id: registration._id },
      {
        $set: {
          reminderStatus: registration.reminderSentAt ? "sent" : "failed",
          lastReminderAttemptAt: attemptedAt,
          lastReminderError: sanitizedEmailError(error),
        },
      }
    );
    return Boolean(registration.reminderSentAt);
  }
}

export async function sendWebinarReminders(
  now: Date = new Date()
): Promise<{ due: boolean; sent: number; failed: number }> {
  if (!isWebinarReminderWindow(now)) {
    return { due: false, sent: 0, failed: 0 };
  }

  let config: ReturnType<typeof requiredEmailConfig>;
  try {
    config = requiredEmailConfig();
  } catch (error) {
    console.error("❌ Webinar reminder skipped: email is not configured", error);
    return { due: true, sent: 0, failed: 0 };
  }

  const runStartedAt = now;
  let sent = 0;
  let failed = 0;

  while (true) {
    const claimed = await WebinarRegistration.findOneAndUpdate(
      {
        eventKey: WEBINAR_EVENT_KEY,
        reminderStatus: { $ne: "sent" },
        $or: [
          { lastReminderAttemptAt: { $exists: false } },
          { lastReminderAttemptAt: { $lt: runStartedAt } },
        ],
      },
      { $set: { lastReminderAttemptAt: new Date() } },
      { new: true }
    );
    if (!claimed) break;
    const delivered = await sendReminder(claimed, config);
    if (delivered) sent += 1;
    else failed += 1;
  }

  return { due: true, sent, failed };
}

export async function registerForWebinar(input: unknown): Promise<{
  ok: true;
  confirmationSent: boolean;
}> {
  const config = requiredEmailConfig();
  const normalized = normalizeWebinarRegistration(input);
  const { registration, created } = await findOrCreateRegistration(normalized);
  const confirmationSent = await sendConfirmation(registration, config);
  if (created) await sendInternalNotification(registration, config);
  return { ok: true, confirmationSent };
}

export function createRaffleAdminSession(password: unknown): {
  token: string;
  expiresInSeconds: number;
} {
  if (!env.RAFFLE_ADMIN_PASSWORD || !env.RAFFLE_ADMIN_SESSION_SECRET) {
    throw new AppError(503, "Raffle admin is not configured");
  }
  if (
    typeof password !== "string" ||
    !constantTimeSecretMatch(password.trim(), env.RAFFLE_ADMIN_PASSWORD)
  ) {
    throw new AppError(401, "Invalid admin password");
  }

  return {
    token: jwt.sign(
      { scope: "webinar:raffle-admin" },
      env.RAFFLE_ADMIN_SESSION_SECRET,
      {
        subject: "webinar-raffle-admin",
        expiresIn: ADMIN_SESSION_SECONDS,
      }
    ),
    expiresInSeconds: ADMIN_SESSION_SECONDS,
  };
}

type RaffleCandidate = {
  _id: mongoose.Types.ObjectId;
  token: string;
  name: string;
  email: string;
  phone: string;
};

export function rankRaffleCandidates<T extends { token: string }>(
  candidates: T[],
  seed: string
): T[] {
  return candidates
    .map((candidate) => ({
      candidate,
      score: createHmac("sha256", Buffer.from(seed, "hex"))
        .update(candidate.token)
        .digest("hex"),
    }))
    .sort(
      (left, right) =>
        left.score.localeCompare(right.score) ||
        left.candidate.token.localeCompare(right.candidate.token)
    )
    .map(({ candidate }) => candidate);
}

export function selectRaffleWinners<T extends { token: string }>(
  candidates: T[],
  seed: string
): T[] {
  if (candidates.length < RAFFLE_WINNER_COUNT) {
    throw new AppError(409, "At least six eligible registrations are required");
  }
  return rankRaffleCandidates(candidates, seed).slice(0, RAFFLE_WINNER_COUNT);
}

function publicDraw(draw: IWebinarDraw): RaffleSummary["draw"] {
  if (draw.status !== "complete" || !draw.drawnAt) return null;
  return {
    drawnAt: draw.drawnAt.toISOString(),
    cutoffAt: draw.cutoffAt.toISOString(),
    eligibleCount: draw.eligibleCount || draw.winners.length,
    winners: draw.winners.map((winner) => ({
      registrationId: String(winner.registrationId),
      token: winner.token,
      name: winner.name,
      email: winner.email,
      phone: winner.phone,
    })),
  };
}

export async function getRaffleSummary(): Promise<RaffleSummary> {
  const [registeredCount, eligibleCount, failedConfirmationCount, draw] =
    await Promise.all([
      WebinarRegistration.countDocuments({ eventKey: WEBINAR_EVENT_KEY }),
      WebinarRegistration.countDocuments({
        eventKey: WEBINAR_EVENT_KEY,
        confirmationSentAt: { $exists: true },
      }),
      WebinarRegistration.countDocuments({
        eventKey: WEBINAR_EVENT_KEY,
        confirmationSentAt: { $exists: false },
        confirmationStatus: "failed",
      }),
      WebinarDraw.findOne({ eventKey: WEBINAR_EVENT_KEY }),
    ]);

  const drawStatus = draw?.status || "not_started";
  return {
    registeredCount,
    eligibleCount,
    failedConfirmationCount,
    canDraw:
      draw?.status === "pending" ||
      (!draw && eligibleCount >= RAFFLE_WINNER_COUNT),
    drawStatus,
    draw: draw ? publicDraw(draw) : null,
  };
}

export async function drawRaffleWinners(): Promise<RaffleSummary> {
  let draw = await WebinarDraw.findOne({ eventKey: WEBINAR_EVENT_KEY }).select(
    "+seed"
  );

  if (!draw) {
    const eligibleCount = await WebinarRegistration.countDocuments({
      eventKey: WEBINAR_EVENT_KEY,
      confirmationSentAt: { $exists: true },
    });
    if (eligibleCount < RAFFLE_WINNER_COUNT) {
      throw new AppError(409, "At least six eligible registrations are required");
    }

    try {
      draw = await WebinarDraw.create({
        eventKey: WEBINAR_EVENT_KEY,
        status: "pending",
        cutoffAt: new Date(),
        algorithm: "hmac-sha256-rank-v1",
        seed: randomBytes(32).toString("hex"),
      });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      draw = await WebinarDraw.findOne({ eventKey: WEBINAR_EVENT_KEY }).select(
        "+seed"
      );
    }
  }

  if (!draw) throw new AppError(500, "Raffle draw could not be initialized");
  if (draw.status === "complete") return getRaffleSummary();

  const candidates = (await WebinarRegistration.find({
    eventKey: WEBINAR_EVENT_KEY,
    confirmationSentAt: { $exists: true, $lte: draw.cutoffAt },
  })
    .select("_id token name email phone")
    .exec()) as unknown as RaffleCandidate[];

  if (candidates.length < RAFFLE_WINNER_COUNT) {
    throw new AppError(409, "At least six eligible registrations are required");
  }

  const winners: WebinarWinner[] = selectRaffleWinners(candidates, draw.seed)
    .map((candidate) => ({
      registrationId: candidate._id,
      token: candidate.token,
      name: candidate.name,
      email: candidate.email,
      phone: candidate.phone,
    }));

  const completed = await WebinarDraw.findOneAndUpdate(
    { _id: draw._id, status: "pending" },
    {
      $set: {
        status: "complete",
        eligibleCount: candidates.length,
        winners,
        drawnAt: new Date(),
      },
    },
    { new: true }
  );

  if (!completed) {
    const existing = await WebinarDraw.findById(draw._id);
    if (!existing) throw new AppError(500, "Raffle result was not persisted");
  }

  return getRaffleSummary();
}
