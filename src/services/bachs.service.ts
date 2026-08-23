import crypto from "crypto";
import { env } from "../config/env";

export const BACHS_CHECKOUT_METHODS = [
  "bank_transfer",
  "card",
  "crypto",
] as const;

/** Below this, a crypto-only `payment_method_options` restriction leaves nothing payable. */
export const BACHS_CRYPTO_MIN_USD = 3;

export type BachsCheckoutMethod = (typeof BACHS_CHECKOUT_METHODS)[number];

export function isBachsCheckoutMethod(
  value: unknown,
): value is BachsCheckoutMethod {
  return (
    typeof value === "string" &&
    (BACHS_CHECKOUT_METHODS as readonly string[]).includes(value)
  );
}

export type BachsPaymentMethodOptions =
  | { card: { currencies: ["USD", "NGN"] } }
  | { card: { currencies: ["USD"] } }
  | { bank_transfer: Record<string, never> }
  | { crypto: Record<string, never> };

export type BachsPricing = {
  currency: "USD";
  amount: string;
  currency_options?: { NGN: string };
};

/** Bachs NGN minimum is 100. Returns a 2-decimal string or null. */
export function parseBachsNgnAmount(value: unknown): string | null {
  const raw =
    typeof value === "number" && Number.isFinite(value)
      ? value.toFixed(2)
      : typeof value === "string"
        ? value.trim()
        : "";
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 100) return null;
  return amount.toFixed(2);
}

export function bachsPaymentMethodOptions(
  method: BachsCheckoutMethod,
  amountNgn?: string,
): BachsPaymentMethodOptions {
  switch (method) {
    case "card":
      return amountNgn
        ? { card: { currencies: ["USD", "NGN"] } }
        : { card: { currencies: ["USD"] } };
    case "bank_transfer":
      return { bank_transfer: {} };
    case "crypto":
      return { crypto: {} };
  }
}

export interface BachsCheckoutCustomer {
  email: string;
  name: string;
}

export interface BachsCheckoutMetadata {
  userId: string;
  planId: string;
  monthsCount: number;
  paymentMethod?: BachsCheckoutMethod;
  transactionId?: string;
}

export interface CreateBachsCheckoutInput {
  email: string;
  name: string;
  amountUsd: number;
  /** Required for bank_transfer; optional for card so NGN cards can be offered. */
  amountNgn?: string;
  paymentMethod: BachsCheckoutMethod;
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
  pricing: BachsPricing;
  payment_method_options: BachsPaymentMethodOptions;
  billing_currency?: "NGN";
  customer: BachsCheckoutCustomer;
  success_url: string;
  cancel_url: string;
  reference: string;
  metadata: BachsCheckoutMetadata;
  expires_in_minutes: number;
}

const WEBHOOK_TOLERANCE_SECONDS = 300;
const BACHS_PRICING_PATH = "/dashboard/settings/pricing";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

export function isBachsPublicCallbackUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    if (LOCAL_HOSTS.has(host)) return false;
    if (host.endsWith(".localhost") || host.endsWith(".local")) return false;
    return true;
  } catch {
    return false;
  }
}

function withPricingPath(origin: string): string {
  return `${origin.replace(/\/$/, "")}${BACHS_PRICING_PATH}`;
}

export function resolveBachsCallbackUrl(options: {
  explicit?: string;
  frontendUrl: string;
  frontendUrls: string[];
}): string {
  const candidates = [
    options.explicit?.trim(),
    ...options.frontendUrls.map(withPricingPath),
    withPricingPath(options.frontendUrl),
  ].filter((url): url is string => Boolean(url));

  const publicUrl = candidates.find(isBachsPublicCallbackUrl);
  if (!publicUrl) {
    throw new Error(
      "Bachs requires a public https success URL. Set BACHS_CALLBACK_URL (localhost is not allowed).",
    );
  }
  return publicUrl;
}

function formatUsdAmount(amountUsd: number): string {
  return amountUsd.toFixed(2);
}

function bachsPricing(
  amountUsd: number,
  amountNgn?: string,
): BachsPricing {
  if (amountNgn) {
    return {
      currency: "USD",
      amount: formatUsdAmount(amountUsd),
      currency_options: { NGN: amountNgn },
    };
  }
  return { currency: "USD", amount: formatUsdAmount(amountUsd) };
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

  static resolveCallbackUrl(): string {
    return resolveBachsCallbackUrl({
      explicit: env.BACHS_CALLBACK_URL,
      frontendUrl: env.FRONTEND_URL,
      frontendUrls: env.FRONTEND_URLS,
    });
  }

  static buildCheckoutSessionRequest(
    input: CreateBachsCheckoutInput,
  ): BachsCheckoutSessionRequest {
    const amountNgn = parseBachsNgnAmount(input.amountNgn) ?? undefined;
    if (input.paymentMethod === "bank_transfer" && !amountNgn) {
      throw new Error(
        "NGN bank transfer requires an NGN price. Set BACHS_NGN_AMOUNT or enable Bachs conversions.",
      );
    }
    if (
      input.paymentMethod === "crypto" &&
      input.amountUsd < BACHS_CRYPTO_MIN_USD
    ) {
      throw new Error(
        `Bachs crypto requires at least $${BACHS_CRYPTO_MIN_USD.toFixed(2)}. ${input.amountUsd.toFixed(2)} USD is below that floor.`,
      );
    }

    return {
      pricing: bachsPricing(input.amountUsd, amountNgn),
      payment_method_options: bachsPaymentMethodOptions(
        input.paymentMethod,
        amountNgn,
      ),
      ...(input.paymentMethod === "bank_transfer"
        ? { billing_currency: "NGN" as const }
        : {}),
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

  static async quoteUsdToNgn(amountUsd: number): Promise<string> {
    const json = await this.request<{ to_amount?: unknown }>(
      "/v1/conversions/quotes",
      {
        method: "POST",
        body: JSON.stringify({
          from_currency: "USD",
          to_currency: "NGN",
          amount: formatUsdAmount(amountUsd),
        }),
      },
    );
    const amountNgn = parseBachsNgnAmount(json.to_amount);
    if (!amountNgn) {
      throw new Error("Bachs conversion quote did not return a usable NGN amount");
    }
    return amountNgn;
  }

  static async resolveNgnAmount(amountUsd: number): Promise<string> {
    const configured = parseBachsNgnAmount(env.BACHS_NGN_AMOUNT);
    if (configured) return configured;
    return this.quoteUsdToNgn(amountUsd);
  }

  static async withNgnAmount(
    input: CreateBachsCheckoutInput,
  ): Promise<CreateBachsCheckoutInput> {
    if (input.amountNgn || input.paymentMethod === "crypto") {
      return input;
    }
    if (input.paymentMethod === "bank_transfer") {
      return { ...input, amountNgn: await this.resolveNgnAmount(input.amountUsd) };
    }
    try {
      return { ...input, amountNgn: await this.resolveNgnAmount(input.amountUsd) };
    } catch (error) {
      console.warn(
        "Could not add an NGN price to the card checkout:",
        (error as Error).message,
      );
      return input;
    }
  }

  static async createCheckoutSession(
    input: CreateBachsCheckoutInput,
  ): Promise<CreateBachsCheckoutResult> {
    const payload = this.buildCheckoutSessionRequest(
      await this.withNgnAmount(input),
    );
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
      throw new Error(`Bachs API error: ${bachsErrorDetail(errorText, response)}`);
    }

    return (await response.json()) as T;
  }
}

function bachsErrorDetail(errorText: string, response: Response): string {
  try {
    const parsed = JSON.parse(errorText) as { detail?: unknown };
    if (typeof parsed.detail === "string" && parsed.detail.trim()) {
      return parsed.detail.trim();
    }
  } catch {
    // fall through to the HTTP status
  }
  if (errorText.trim()) return errorText.trim();
  return `${response.status} ${response.statusText}`;
}
