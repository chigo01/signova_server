import { Request, Response } from "express";
import { SignalService } from "../services/signal.service";
import { asyncHandler } from "../middleware/asyncHandler";
import { AppError } from "../middleware/errorHandler";
import { env } from "../config/env";
import User from "../models/user.model";
import SignalAlertNotification, {
  SignalAlertType,
} from "../models/signalAlertNotification.model";
import { sendEmail } from "../services/email/email.service";
import { deriveFirstName } from "../services/email/templates/_shared";
import { newSignalEmail } from "../services/email/templates/newSignal";
import { tp1HitEmail } from "../services/email/templates/tp1Hit";
import { tp2HitEmail } from "../services/email/templates/tp2Hit";
import { slHitEmail } from "../services/email/templates/slHit";
import { slApproachingEmail } from "../services/email/templates/slApproaching";

export const getApprovedSignals = asyncHandler(
  async (_req: Request, res: Response) => {
    const data = await SignalService.getApprovedSignals();
    console.log("data", data);
    res.status(200).json(data);
  },
);

export const playSignal = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.userId;
  const { signalId, symbol, signalType, entryPrice, targetPrice, stopLoss } =
    req.body;

  if (!signalId || !symbol || !signalType || !entryPrice) {
    throw new AppError(
      400,
      "Missing required fields: signalId, symbol, signalType, entryPrice",
    );
  }

  const signalPlay = await SignalService.playSignal({
    userId,
    signalId,
    symbol,
    signalType,
    entryPrice,
    targetPrice,
    stopLoss,
  });

  res.status(201).json({
    message: "Signal played successfully",
    data: signalPlay,
  });
});

export const getSignalHistory = asyncHandler(
  async (req: Request, res: Response) => {
    const pageRaw = Number.parseInt(String(req.query.page ?? ""), 10);
    const limitRaw = Number.parseInt(String(req.query.limit ?? ""), 10);
    const page =
      Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : undefined;
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;

    const result = await SignalService.getSignalHistory(page, limit);
    res.status(200).json(result);
  },
);

export const getApprovedSignalsWinRate = asyncHandler(
  async (_req: Request, res: Response) => {
    const stats = await SignalService.getApprovedSignalsWinRate();
    res.status(200).json({ success: true, ...stats });
  },
);

export const invalidateApprovedCache = asyncHandler(
  async (req: Request, res: Response) => {
    const expected = env.SIGNALS_INVALIDATE_SECRET;
    if (!expected) {
      throw new AppError(503, "Cache invalidation not configured");
    }
    if (req.header("x-invalidate-secret") !== expected) {
      throw new AppError(401, "Invalid invalidation secret");
    }
    await SignalService.invalidateApprovedCache();
    res.status(204).send();
  },
);

// Match Resend's account-wide 5 req/sec ceiling: 5 concurrent per batch,
// 1.1s pause between batches. Mirrors the cadence in admin-server's
// endUserEmail.service.ts so behavior is consistent across both senders.
const ALERT_BROADCAST_CONCURRENCY = 5;
const ALERT_BROADCAST_BATCH_INTERVAL_MS = 1100;
const EMAIL_FORMAT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

type AlertPayload = {
  alertType: SignalAlertType;
  signalId: string;
  pair: string;
  direction: "BUY" | "SELL" | "HOLD";
  entryPrice: number;
  takeProfit1: number;
  takeProfit2: number;
  stopLoss: number;
  pipsAway?: number;
  pipsLoss?: number;
  reasoning?: string;
  evaluatedPrice?: number;
  timeframe?: string;
  riskLevel?: string;
};

function parseAlertPayload(body: unknown): AlertPayload {
  if (!body || typeof body !== "object") {
    throw new AppError(400, "Invalid alert payload");
  }
  const b = body as Record<string, unknown>;

  const alertType = b.alertType;
  if (
    alertType !== "NEW_SIGNAL" &&
    alertType !== "TP1" &&
    alertType !== "TP2" &&
    alertType !== "SL" &&
    alertType !== "SL_WARNING"
  ) {
    throw new AppError(400, "Invalid alertType");
  }

  const signalId =
    typeof b.signalId === "string" && b.signalId.trim().length > 0
      ? b.signalId.trim()
      : null;
  if (!signalId) {
    throw new AppError(400, "Missing signalId");
  }

  const pair = typeof b.pair === "string" && b.pair.length > 0 ? b.pair : null;
  if (!pair) {
    throw new AppError(400, "Missing pair");
  }

  const direction = b.direction;
  if (direction !== "BUY" && direction !== "SELL" && direction !== "HOLD") {
    throw new AppError(400, "Invalid direction");
  }

  const numericFields = ["entryPrice", "takeProfit1", "takeProfit2", "stopLoss"] as const;
  for (const f of numericFields) {
    if (typeof b[f] !== "number" || !Number.isFinite(b[f] as number)) {
      throw new AppError(400, `Missing or invalid ${f}`);
    }
  }

  const optionalNumber = (key: string): number | undefined => {
    const v = b[key];
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  };

  return {
    alertType,
    signalId,
    pair,
    direction,
    entryPrice: b.entryPrice as number,
    takeProfit1: b.takeProfit1 as number,
    takeProfit2: b.takeProfit2 as number,
    stopLoss: b.stopLoss as number,
    pipsAway: optionalNumber("pipsAway"),
    pipsLoss: optionalNumber("pipsLoss"),
    reasoning: typeof b.reasoning === "string" ? b.reasoning : undefined,
    evaluatedPrice: optionalNumber("evaluatedPrice"),
    timeframe: typeof b.timeframe === "string" && b.timeframe.length > 0 ? b.timeframe : undefined,
    riskLevel: typeof b.riskLevel === "string" && b.riskLevel.length > 0 ? b.riskLevel : undefined,
  };
}

function buildAlertEmail(
  payload: AlertPayload,
  firstName: string,
): { subject: string; html: string } {
  switch (payload.alertType) {
    case "NEW_SIGNAL":
      return newSignalEmail({
        firstName,
        pair: payload.pair,
        direction: payload.direction,
        entryPrice: payload.entryPrice,
        takeProfit1: payload.takeProfit1,
        takeProfit2: payload.takeProfit2,
        stopLoss: payload.stopLoss,
        timeframe: payload.timeframe ?? "",
        riskLevel: payload.riskLevel,
        reasoning: payload.reasoning,
      });
    case "TP1":
      return tp1HitEmail({
        firstName,
        pair: payload.pair,
        direction: payload.direction,
        takeProfit1: payload.takeProfit1,
        takeProfit2: payload.takeProfit2,
      });
    case "TP2":
      return tp2HitEmail({
        firstName,
        pair: payload.pair,
        direction: payload.direction,
        entryPrice: payload.entryPrice,
        takeProfit1: payload.takeProfit1,
        takeProfit2: payload.takeProfit2,
      });
    case "SL_WARNING":
      return slApproachingEmail({
        firstName,
        pair: payload.pair,
        stopLoss: payload.stopLoss,
        pipsAway: payload.pipsAway,
      });
    case "SL":
      return slHitEmail({
        firstName,
        pair: payload.pair,
        direction: payload.direction,
        entryPrice: payload.entryPrice,
        stopLoss: payload.stopLoss,
        pipsLoss: payload.pipsLoss,
        explanation: payload.reasoning,
      });
  }
}

export const handleSignalAlert = asyncHandler(
  async (req: Request, res: Response) => {
    const expected = env.SIGNALS_ALERT_SECRET;
    if (!expected) {
      throw new AppError(503, "Signal alert webhook not configured");
    }
    if (req.header("x-alert-secret") !== expected) {
      throw new AppError(401, "Invalid alert secret");
    }

    const payload = parseAlertPayload(req.body);

    // HOLD signals have no actionable entry/TP/SL — skip them silently, the
    // way signalApprovedNotifier in admin-server already skips HOLD for the
    // new-signal email.
    if (payload.direction === "HOLD") {
      res.status(204).send();
      return;
    }

    // PAUSED: SL hit and SL-approaching emails to users are temporarily disabled.
    // Acknowledge with 200 so admin-server's webhook forward succeeds and does not
    // retry. Remove this block to resume SL emails. TP1/TP2 are unaffected.
    if (payload.alertType === "SL" || payload.alertType === "SL_WARNING") {
      res.status(200).json({ status: "paused" });
      return;
    }

    // Idempotency gate: try to create the (signalId, alertType) record first.
    // If the unique index rejects it (E11000), the alert has already been
    // processed — return early without sending. This is what makes the
    // "once it hits TP2, emails stop" / "once it hits SL, emails stop"
    // requirement bulletproof even under webhook retries.
    let notificationId: string;
    try {
      const created = await SignalAlertNotification.create({
        signalId: payload.signalId,
        alertType: payload.alertType,
      });
      notificationId = String(created._id);
    } catch (err) {
      const isDuplicate =
        typeof err === "object" &&
        err !== null &&
        (err as { code?: number }).code === 11000;
      if (isDuplicate) {
        res.status(200).json({ status: "already_sent" });
        return;
      }
      throw err;
    }

    // Pull recipients, filtered by notification preference. NEW_SIGNAL maps to
    // the "newSignals" toggle; every TP/SL alert maps to "tradeAlerts". The
    // { $ne: false } filter keeps users whose preference is missing (opted-in
    // by default), so existing users need no migration. We dedupe by lowercased
    // email and skip syntactically malformed addresses so we don't waste Resend
    // calls on garbage rows.
    const prefKey =
      payload.alertType === "NEW_SIGNAL" ? "newSignals" : "tradeAlerts";
    const docs = await User.find({
      email: { $exists: true, $type: "string", $ne: "" },
      [`notificationPreferences.${prefKey}`]: { $ne: false },
    })
      .select("email name")
      .lean();

    const seen = new Set<string>();
    const recipients: Array<{ email: string; firstName: string }> = [];
    for (const doc of docs) {
      const email = (doc as { email?: string }).email?.trim().toLowerCase();
      if (!email || seen.has(email)) continue;
      if (!EMAIL_FORMAT_RE.test(email)) continue;
      seen.add(email);
      recipients.push({
        email,
        firstName: deriveFirstName((doc as { name?: string | null }).name),
      });
    }

    let sent = 0;
    let failed = 0;

    const sendOne = async (recipient: {
      email: string;
      firstName: string;
    }): Promise<void> => {
      try {
        const { subject, html } = buildAlertEmail(payload, recipient.firstName);
        await sendEmail({ to: recipient.email, subject, html });
        sent++;
      } catch (sendError) {
        failed++;
        console.error(
          `[signal-alert] send failed for ${recipient.email} (${payload.alertType} ${payload.pair} ${payload.signalId}):`,
          sendError,
        );
      }
    };

    for (let i = 0; i < recipients.length; i += ALERT_BROADCAST_CONCURRENCY) {
      const batch = recipients.slice(i, i + ALERT_BROADCAST_CONCURRENCY);
      await Promise.all(batch.map(sendOne));
      if (i + ALERT_BROADCAST_CONCURRENCY < recipients.length) {
        await sleep(ALERT_BROADCAST_BATCH_INTERVAL_MS);
      }
    }

    await SignalAlertNotification.findByIdAndUpdate(notificationId, {
      $set: { recipientCount: sent },
    });

    console.log(
      `[signal-alert] ${payload.alertType} ${payload.pair} ${payload.signalId}: sent=${sent} failed=${failed} total=${recipients.length}`,
    );

    res.status(200).json({
      status: "sent",
      recipientCount: sent,
      failed,
    });
  },
);
