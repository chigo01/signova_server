import crypto from "crypto";
import { env } from "../config/env";

const BASE_URL = "https://api.paystack.co";

export interface InitializeTransactionInput {
  email: string;
  amountNgn: number;
  reference: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface InitializeTransactionResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

export interface VerifyTransactionResult {
  status: string;
  amount: number;
  currency: string;
  reference: string;
  raw: unknown;
}

export class PaystackService {
  private static headers() {
    if (!env.PAYSTACK_SECRET_KEY) {
      throw new Error("Missing PAYSTACK_SECRET_KEY in environment variables");
    }
    return {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
    };
  }

  static async initializeTransaction(
    input: InitializeTransactionInput,
  ): Promise<InitializeTransactionResult> {
    const response = await fetch(`${BASE_URL}/transaction/initialize`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        email: input.email,
        amount: Math.round(input.amountNgn * 100),
        currency: "NGN",
        reference: input.reference,
        callback_url: input.callbackUrl,
        metadata: input.metadata,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Paystack initializeTransaction error:", errorText);
      throw new Error(`Paystack API error: ${response.statusText}`);
    }

    const json = (await response.json()) as {
      status?: boolean;
      message?: string;
      data?: {
        authorization_url: string;
        access_code: string;
        reference: string;
      };
    };

    if (!json.status || !json.data) {
      throw new Error(`Paystack initialize failed: ${json.message ?? "unknown error"}`);
    }

    return {
      authorizationUrl: json.data.authorization_url,
      accessCode: json.data.access_code,
      reference: json.data.reference,
    };
  }

  static async verifyTransaction(
    reference: string,
  ): Promise<VerifyTransactionResult> {
    const response = await fetch(
      `${BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,
      { method: "GET", headers: this.headers() },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Paystack verifyTransaction error:", errorText);
      throw new Error(`Paystack verify API error: ${response.statusText}`);
    }

    const json = (await response.json()) as {
      status?: boolean;
      data?: {
        status: string;
        amount: number;
        currency: string;
        reference: string;
      };
    };

    if (!json.status || !json.data) {
      throw new Error("Paystack verify returned no data");
    }

    return {
      status: json.data.status,
      amount: json.data.amount,
      currency: json.data.currency,
      reference: json.data.reference,
      raw: json.data,
    };
  }

  static verifyWebhookSignature(
    rawBody: Buffer | string,
    signature: string | undefined,
  ): boolean {
    if (!signature || !env.PAYSTACK_SECRET_KEY) return false;
    const body =
      typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
    const computed = crypto
      .createHmac("sha512", env.PAYSTACK_SECRET_KEY)
      .update(body)
      .digest("hex");
    const computedBuf = Buffer.from(computed, "hex");
    let signatureBuf: Buffer;
    try {
      signatureBuf = Buffer.from(signature, "hex");
    } catch {
      return false;
    }
    if (computedBuf.length !== signatureBuf.length) return false;
    return crypto.timingSafeEqual(computedBuf, signatureBuf);
  }
}
