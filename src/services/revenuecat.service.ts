import crypto from "crypto";
import mongoose from "mongoose";
import { env } from "../config/env";
import User, { IUser } from "../models/user.model";

export const REVENUECAT_ENTITLEMENT_ID = env.REVENUECAT_ENTITLEMENT_ID;

interface RevenueCatEntitlement {
  expires_date?: string | null;
  product_identifier?: string | null;
  purchase_date?: string | null;
}

interface RevenueCatSubscription {
  expires_date?: string | null;
  store?: string | null;
  unsubscribe_detected_at?: string | null;
  billing_issues_detected_at?: string | null;
  original_purchase_date?: string | null;
}

interface RevenueCatSubscriberResponse {
  subscriber?: {
    entitlements?: Record<string, RevenueCatEntitlement>;
    subscriptions?: Record<string, RevenueCatSubscription>;
  };
}

export interface RevenueCatWebhookEvent {
  id?: string;
  type?: string;
  app_user_id?: string;
  entitlement_id?: string | null;
  entitlement_ids?: string[] | null;
  product_id?: string | null;
  store?: string | null;
  environment?: "SANDBOX" | "PRODUCTION" | null;
  original_transaction_id?: string | null;
  event_timestamp_ms?: number | null;
}

function parseDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function timingSafeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export class RevenueCatService {
  static appUserIdFor(user: Pick<IUser, "_id">): string {
    return String(user._id);
  }

  static isApiConfigured(): boolean {
    return Boolean(env.REVENUECAT_API_KEY);
  }

  static verifyWebhook(
    rawBody: Buffer,
    authorization: string | undefined,
    signatureHeader: string | undefined,
  ): boolean {
    const expectedAuthorization = env.REVENUECAT_WEBHOOK_AUTHORIZATION;
    const signingSecret = env.REVENUECAT_WEBHOOK_SIGNING_SECRET;
    if (!expectedAuthorization && !signingSecret) return false;

    if (
      expectedAuthorization &&
      (!authorization || !timingSafeEqual(authorization, expectedAuthorization))
    ) {
      return false;
    }
    if (!signingSecret) return true;
    if (!signatureHeader) return false;

    const parts = Object.fromEntries(
      signatureHeader.split(",").map((part) => {
        const [key, ...value] = part.trim().split("=");
        return [key, value.join("=")];
      }),
    );
    const timestamp = parts.t;
    const signature = parts.v1;
    if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;

    // Reject signatures older than five minutes to reduce replay risk.
    if (Math.abs(Date.now() - Number(timestamp) * 1000) > 5 * 60 * 1000) {
      return false;
    }
    const expected = crypto
      .createHmac("sha256", signingSecret)
      .update(`${timestamp}.`)
      .update(rawBody)
      .digest("hex");
    return timingSafeEqual(signature, expected);
  }

  static async fetchSubscriber(
    appUserId: string,
  ): Promise<RevenueCatSubscriberResponse> {
    if (!env.REVENUECAT_API_KEY) {
      throw new Error("RevenueCat API is not configured");
    }
    const response = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
      {
        headers: {
          Authorization: `Bearer ${env.REVENUECAT_API_KEY}`,
          "Content-Type": "application/json",
        },
      },
    );
    if (!response.ok) {
      throw new Error(`RevenueCat subscriber lookup failed (${response.status})`);
    }
    return (await response.json()) as RevenueCatSubscriberResponse;
  }

  static async syncUser(
    user: IUser,
    event?: RevenueCatWebhookEvent,
  ): Promise<IUser> {
    const response = await this.fetchSubscriber(this.appUserIdFor(user));
    const subscriber = response.subscriber ?? {};
    const entitlement = subscriber.entitlements?.[REVENUECAT_ENTITLEMENT_ID];
    const expiresAt = parseDate(entitlement?.expires_date);
    const entitlementActive = Boolean(
      entitlement && (!expiresAt || expiresAt.getTime() > Date.now()),
    );
    const productId = entitlement?.product_identifier ?? event?.product_id ?? undefined;
    const subscription = productId
      ? subscriber.subscriptions?.[productId]
      : undefined;
    const hasBillingIssue = Boolean(subscription?.billing_issues_detected_at);
    const cancelled = Boolean(subscription?.unsubscribe_detected_at);
    const status = entitlementActive
      ? hasBillingIssue
        ? "billing_issue"
        : cancelled
          ? "cancelled"
          : "active"
      : "expired";

    user.mobileSubscription = {
      provider: "revenuecat",
      entitlementId: REVENUECAT_ENTITLEMENT_ID,
      entitlementActive,
      productId,
      store: subscription?.store ?? event?.store ?? undefined,
      environment: event?.environment ?? user.mobileSubscription?.environment,
      status,
      expiresAt,
      willRenew: entitlementActive && !cancelled && !hasBillingIssue,
      originalTransactionId:
        event?.original_transaction_id ??
        user.mobileSubscription?.originalTransactionId,
      lastEventTimestampMs:
        event?.event_timestamp_ms ?? user.mobileSubscription?.lastEventTimestampMs,
      syncedAt: new Date(),
    };
    await user.save();
    return user;
  }

  static async syncUserById(
    userId: string,
    event?: RevenueCatWebhookEvent,
  ): Promise<IUser> {
    const user = await User.findById(userId);
    if (!user) throw new Error("User not found");
    return this.syncUser(user, event);
  }

  static async syncUserByAppUserId(
    appUserId: string,
    event?: RevenueCatWebhookEvent,
  ): Promise<IUser | null> {
    if (!mongoose.Types.ObjectId.isValid(appUserId)) return null;
    const user = await User.findById(appUserId);
    if (!user) return null;
    return this.syncUser(user, event);
  }
}
