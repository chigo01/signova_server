import { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { AppError } from "../middleware/errorHandler";
import WebhookEvent from "../models/webhook-event.model";
import { effectivePlan, effectiveProExpiry } from "../services/planEntitlement.service";
import { ReferralService } from "../services/referral.service";
import {
  REVENUECAT_ENTITLEMENT_ID,
  RevenueCatService,
  RevenueCatWebhookEvent,
} from "../services/revenuecat.service";

function subscriptionPayload(user: Awaited<ReturnType<typeof RevenueCatService.syncUserById>>) {
  return {
    plan: effectivePlan(user),
    proPlanExpiry: effectiveProExpiry(user),
    mobileSubscription: user.mobileSubscription,
  };
}

export const syncRevenueCatSubscription = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) throw new AppError(401, "Unauthorized");
    if (!RevenueCatService.isApiConfigured()) {
      throw new AppError(503, "Mobile subscriptions are not configured");
    }

    const user = await RevenueCatService.syncUserById(req.user.userId);
    res.status(200).json(subscriptionPayload(user));
  },
);

export const revenueCatWebhook = asyncHandler(
  async (req: Request, res: Response) => {
    const rawBody = req.body as Buffer;
    if (!Buffer.isBuffer(rawBody)) {
      res.status(400).send("invalid body");
      return;
    }

    const authorization = req.headers.authorization;
    const signature = req.headers["x-revenuecat-webhook-signature"] as
      | string
      | undefined;
    if (!RevenueCatService.verifyWebhook(rawBody, authorization, signature)) {
      res.status(401).send("invalid signature");
      return;
    }

    let payload: { api_version?: string; event?: RevenueCatWebhookEvent };
    try {
      payload = JSON.parse(rawBody.toString("utf8")) as typeof payload;
    } catch {
      res.status(400).send("invalid json");
      return;
    }

    const event = payload.event;
    if (!event?.id || !event.type) {
      res.status(400).send("invalid event");
      return;
    }
    const duplicate = await WebhookEvent.exists({
      provider: "revenuecat",
      eventId: event.id,
    });
    if (duplicate) {
      res.status(200).send("OK: duplicate");
      return;
    }

    // RevenueCat dashboard test events can carry an anonymous/sample customer.
    // A missing Signova user is acknowledged but recorded for audit purposes.
    const user = event.app_user_id
      ? await RevenueCatService.syncUserByAppUserId(event.app_user_id, event)
      : null;
    const appliesToPro =
      event.entitlement_id === REVENUECAT_ENTITLEMENT_ID ||
      event.entitlement_ids?.includes(REVENUECAT_ENTITLEMENT_ID);
    if (user && event.type === "INITIAL_PURCHASE" && appliesToPro) {
      await ReferralService.creditSubscribedReferral(String(user._id));
    }

    try {
      await WebhookEvent.create({
        provider: "revenuecat",
        eventId: event.id,
        type: event.type,
      });
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
    }

    res.status(200).send(user ? "OK" : "OK: user not found");
  },
);
