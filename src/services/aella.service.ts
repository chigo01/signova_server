import crypto from "crypto";
import { env } from "../config/env";
import { parseBachsNgnAmount } from "./bachs.service";

export const AELLA_VA_EXPIRY_MINUTES = 60;

export interface CreateAellaVirtualAccountInput {
  accountName: string;
  amountNgn: string;
  expiryTimeInMinutes?: number;
}

export interface AellaVirtualAccount {
  id: string;
  accountNumber: string;
  accountName: string;
  bankName: string;
  amountNgn: number;
  expiresAt: Date;
}

export interface AellaDynamicTransaction {
  accountNumber: string | null;
  amount: number | null;
  status: string | null;
  raw: unknown;
}

export function aellaNgnNumber(amountNgn: string): number {
  const parsed = parseBachsNgnAmount(amountNgn);
  if (!parsed) {
    throw new Error("Aella requires a NGN amount of at least 100.00");
  }
  return Number(parsed);
}

export function aellaAmountsMatch(
  expectedNgn: number,
  received: unknown,
): boolean {
  const receivedNumber =
    typeof received === "number"
      ? received
      : typeof received === "string"
        ? Number(received)
        : Number.NaN;
  if (!Number.isFinite(expectedNgn) || !Number.isFinite(receivedNumber)) {
    return false;
  }
  return Math.abs(expectedNgn - receivedNumber) < 0.005;
}

export function isSuccessfulAellaStatus(status: string | null | undefined): boolean {
  const value = (status || "").toLowerCase();
  return value === "success" || value === "succeeded" || value === "completed";
}

export function isFailedAellaStatus(status: string | null | undefined): boolean {
  const value = (status || "").toLowerCase();
  return value === "failed" || value === "expired" || value === "cancelled";
}

/**
 * Aella issues `ae_sk_live…` / `ae_sk_test…` (no extra underscore after live/test).
 * Docs copy as `ae_sk_live_…`; sending that form is a 401.
 */
export function normalizeAellaSecretKey(
  raw: string | undefined,
): string | undefined {
  if (raw == null) return undefined;
  let key = raw.trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  if (!key) return undefined;

  const docsStyle = key.match(/^(ae_(?:sk|to)_(?:test|live))_(.+)$/i);
  if (docsStyle) {
    return `${docsStyle[1].toLowerCase()}${docsStyle[2]}`;
  }
  return key;
}

export class AellaService {
  static secretKey(): string | undefined {
    return normalizeAellaSecretKey(env.AELLA_SECRET_KEY);
  }

  static isConfigured(): boolean {
    return Boolean(this.secretKey());
  }

  static verifyWebhookSignature(
    rawBody: Buffer | string,
    secret: string | undefined,
    signatureHeader: string | undefined,
  ): boolean {
    const key = normalizeAellaSecretKey(secret);
    if (!key || !signatureHeader) return false;
    const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
    const expected = crypto.createHmac("sha512", key).update(body).digest("hex");
    const expectedBuf = Buffer.from(expected, "utf8");
    const signatureBuf = Buffer.from(signatureHeader, "utf8");
    if (expectedBuf.length !== signatureBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, signatureBuf);
  }

  static buildDynamicAccountRequest(input: CreateAellaVirtualAccountInput): {
    accountName: string;
    amount: number;
    expiryTimeInMinutes: number;
  } {
    const accountName = input.accountName.trim();
    if (!accountName) {
      throw new Error("Aella virtual account name is required");
    }
    const expiry = input.expiryTimeInMinutes ?? AELLA_VA_EXPIRY_MINUTES;
    if (expiry < 1 || expiry > AELLA_VA_EXPIRY_MINUTES) {
      throw new Error("Aella virtual accounts expire in 1 to 60 minutes");
    }
    return {
      accountName,
      amount: aellaNgnNumber(input.amountNgn),
      expiryTimeInMinutes: expiry,
    };
  }

  static async createDynamicVirtualAccount(
    input: CreateAellaVirtualAccountInput,
  ): Promise<AellaVirtualAccount> {
    const payload = this.buildDynamicAccountRequest(input);
    const json = await this.request<{
      data?: {
        id?: string;
        accountNumber?: string;
        accountName?: string;
        bankName?: string;
        virtualAmount?: number;
        expiresAt?: string;
      };
    }>("/wallets/virtual/dynamic", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const data = json.data ?? {};
    if (!data.id || !data.accountNumber) {
      throw new Error("Aella virtual account was missing an account number");
    }

    const amountNgn =
      typeof data.virtualAmount === "number" && Number.isFinite(data.virtualAmount)
        ? data.virtualAmount
        : payload.amount;
    const expiresAt = data.expiresAt ? new Date(data.expiresAt) : new Date();
    if (Number.isNaN(expiresAt.getTime())) {
      expiresAt.setTime(Date.now() + payload.expiryTimeInMinutes * 60_000);
    }

    return {
      id: data.id,
      accountNumber: data.accountNumber,
      accountName: data.accountName?.trim() || payload.accountName,
      bankName: data.bankName?.trim() || "Aella Microfinance Bank",
      amountNgn,
      expiresAt,
    };
  }

  static async getDynamicAccountTransaction(
    accountNumber: string,
  ): Promise<AellaDynamicTransaction> {
    const json = await this.request<{
      data?: {
        accountNumber?: string;
        amount?: number;
        status?: string;
      };
    }>(
      `/wallets/virtual/dynamic/${encodeURIComponent(accountNumber)}/transaction`,
    );
    const data = json.data ?? {};
    return {
      accountNumber:
        typeof data.accountNumber === "string" ? data.accountNumber : null,
      amount: typeof data.amount === "number" ? data.amount : null,
      status: typeof data.status === "string" ? data.status : null,
      raw: json,
    };
  }

  private static headers(): Record<string, string> {
    const key = this.secretKey();
    if (!key) {
      throw new Error("Missing AELLA_SECRET_KEY in environment variables");
    }
    return {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
  }

  private static async request<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const response = await fetch(`${env.AELLA_BASE_URL}${path}`, {
      ...init,
      headers: {
        ...this.headers(),
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Aella API error for ${path}:`, errorText);
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `Aella rejected the API key (${response.status}): ${aellaErrorDetail(errorText, response)}. Use the secret exactly as shown on merchant.aellaapp.com (ae_sk_live… / ae_sk_test… — no extra underscore after live/test). If IP whitelisting is on, allow this machine's public IP.`,
        );
      }
      throw new Error(`Aella API error: ${aellaErrorDetail(errorText, response)}`);
    }

    return (await response.json()) as T;
  }
}

function aellaErrorDetail(errorText: string, response: Response): string {
  try {
    const parsed = JSON.parse(errorText) as {
      message?: unknown;
      detail?: unknown;
    };
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message.trim();
    }
    if (typeof parsed.detail === "string" && parsed.detail.trim()) {
      return parsed.detail.trim();
    }
  } catch {
    // fall through
  }
  if (errorText.trim()) return errorText.trim();
  return `${response.status} ${response.statusText}`;
}
