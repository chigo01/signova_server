import crypto from "crypto";
import { env } from "../config/env";

export const BACHS_CRYPTO_METHODS = ["crypto"] as const;

export interface BachsCheckoutCustomer {
  email: string;
  name: string;
}

export interface BachsCheckoutMetadata {
  userId: string;
  planId: string;
  monthsCount: number;
  transactionId?: string;
}

export interface CreateBachsCheckoutInput {
  email: string;
  name: string;
  amountUsd: number;
  reference: string;
  successUrl: string;
  cancelUrl: string;
  metadata: BachsCheckoutMetadata;
  expiresInMinutes?: number;
}

export interface CreateBachsCheckoutResult {
  checkoutId: string;
  checkoutUrl: string;
  status: string;
  reference?: string | null;
  expiresAt?: string;
}

export interface BachsCheckoutSession {
  checkoutId: string;
  status: string;
  paymentStatus?: string | null;
  reference?: string | null;
  paymentMethod?: string | null;
  chargeStatus?: string | null;
  chargeId?: string | null;
  raw: unknown;
}

export interface BachsCheckoutSessionRequest {
  pricing: { currency: "USD"; amount: string };
  allowed_payment_method_types: typeof BACHS_CRYPTO_METHODS;
  customer: BachsCheckoutCustomer;
  success_url: string;
  cancel_url: string;
  reference: string;
  metadata: BachsCheckoutMetadata;
  expires_in_minutes: number;
}

const WEBHOOK_TOLERANCE_SECONDS = 300;

function formatUsdAmount(amountUsd: number): string {
  return amountUsd.toFixed(2);
}

function customerNameFromEmail(email: string): string {
  const local = email.split("@")[0]?.trim();
  return local || "Signova customer";
}

export function resolveBachsCustomerName(
  name: string | undefined,
  email: string,
): string {
  const trimmed = name?.trim();
  return trimmed || customerNameFromEmail(email);
}

export class BachsService {
  static isConfigured(): boolean {
    return Boolean(env.BACHS_API_KEY);
  }

  static buildCheckoutSessionRequest(
    input: CreateBachsCheckoutInput,
  ): BachsCheckoutSessionRequest {
    return {
      pricing: {
        currency: "USD",
        amount: formatUsdAmount(input.amountUsd),
      },
      allowed_payment_method_types: [...BACHS_CRYPTO_METHODS],
      customer: {
        email: input.email,
        name: resolveBachsCustomerName(input.name, input.email),
      },
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      reference: input.reference,
      metadata: input.metadata,
      expires_in_minutes: input.expiresInMinutes ?? 60,
    };
  }

  static async createCheckoutSession(
    input: CreateBachsCheckoutInput,
  ): Promise<CreateBachsCheckoutResult> {
    const payload = this.buildCheckoutSessionRequest(input);
    const json = await this.request<{
      checkout_id?: string;
      checkout_url?: string;
      status?: string;
      reference?: string | null;
      expires_at?: string;
    }>("/v1/checkout-sessions", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (!json.checkout_id || !json.checkout_url) {
      throw new Error("Bachs checkout session was missing a URL");
    }

    return {
      checkoutId: json.checkout_id,
      checkoutUrl: json.checkout_url,
      status: json.status ?? "open",
      reference: json.reference,
      expiresAt: json.expires_at,
    };
  }

  static async getCheckoutSession(
    checkoutId: string,
  ): Promise<BachsCheckoutSession> {
    const json = await this.request<Record<string, unknown>>(
      `/v1/checkout-sessions/${encodeURIComponent(checkoutId)}`,
    );
    const charge =
      json.charge && typeof json.charge === "object"
        ? (json.charge as Record<string, unknown>)
        : null;

    return {
      checkoutId:
        typeof json.checkout_id === "string" ? json.checkout_id : checkoutId,
      status: typeof json.status === "string" ? json.status : "open",
      paymentStatus:
        typeof json.payment_status === "string" ? json.payment_status : null,
      reference: typeof json.reference === "string" ? json.reference : null,
      paymentMethod:
        typeof json.payment_method === "string" ? json.payment_method : null,
      chargeStatus:
        charge && typeof charge.status === "string" ? charge.status : null,
      chargeId:
        charge && typeof charge.payment_id === "string"
          ? charge.payment_id
          : null,
      raw: json,
    };
  }

  static isSuccessfulCheckout(session: BachsCheckoutSession): boolean {
    const charge = (session.chargeStatus || "").toLowerCase();
    const payment = (session.paymentStatus || "").toLowerCase();
    const status = (session.status || "").toLowerCase();
    if (charge === "underpaid") return false;
    if (charge === "succeeded" || charge === "accepted" || charge === "overpaid") {
      return true;
    }
    return status === "completed" && payment === "succeeded";
  }

  static isFailedCheckout(session: BachsCheckoutSession): boolean {
    const status = (session.status || "").toLowerCase();
    const payment = (session.paymentStatus || "").toLowerCase();
    const charge = (session.chargeStatus || "").toLowerCase();
    return (
      status === "expired" ||
      status === "cancelled" ||
      payment === "failed" ||
      payment === "canceled" ||
      charge === "failed" ||
      charge === "expired" ||
      charge === "cancelled"
    );
  }

  static verifyWebhookSignature(
    rawBody: Buffer | string,
    secret: string | undefined,
    timestampHeader: string | undefined,
    signatureHeader: string | undefined,
    nowMs: number = Date.now(),
    toleranceSeconds: number = WEBHOOK_TOLERANCE_SECONDS,
  ): boolean {
    if (!secret || !timestampHeader || !signatureHeader) return false;

    const timestamp = Number.parseInt(timestampHeader, 10);
    if (!Number.isFinite(timestamp)) return false;
    if (Math.abs(nowMs / 1000 - timestamp) > toleranceSeconds) return false;

    const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
    const message = `${timestamp}.${body}`;
    const expected = crypto
      .createHmac("sha256", secret)
      .update(message, "utf8")
      .digest("hex");

    const expectedBuf = Buffer.from(expected, "utf8");
    const signatureBuf = Buffer.from(signatureHeader, "utf8");
    if (expectedBuf.length !== signatureBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, signatureBuf);
  }

  private static headers(): Record<string, string> {
    if (!env.BACHS_API_KEY) {
      throw new Error("Missing BACHS_API_KEY in environment variables");
    }
    return {
      Authorization: `Bearer ${env.BACHS_API_KEY}`,
      "Content-Type": "application/json",
    };
  }

  private static async request<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const response = await fetch(`${env.BACHS_BASE_URL}${path}`, {
      ...init,
      headers: {
        ...this.headers(),
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Bachs API error for ${path}:`, errorText);
      throw new Error(`Bachs API error: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
  }
}
