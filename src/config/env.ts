import { AUTH_CONSTANTS } from "./constants";

/** Accepts true/1/yes (any case); many hosts set booleans differently than lowercase "true". */
function parseEnvTruthy(value: string | undefined): boolean {
  if (value == null || value === "") return false;
  const v = value.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

function normalizeTestOtpCode(raw: string | undefined): string | undefined {
  if (raw == null) return undefined;
  let s = raw.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s || undefined;
}

interface EnvConfig {
  NODE_ENV: string;
  PORT: number;
  MONGO_URI: string;
  JWT_SECRET: string;
  FRONTEND_URL: string;
  FRONTEND_URLS: string[];
  ADMIN_SERVER_URL: string;
  SIGNALS_INVALIDATE_SECRET?: string;
  RESEND_API_KEY?: string;
  FCSAPI_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  FINNHUB_API_KEY?: string;
  ALPHAVANTAGE_API_KEY?: string;
  OPENAI_API_KEY?: string;
  AELLA_SECRET_KEY?: string;
  DEXTOPUS_BASE_URL: string;
  DEXTOPUS_TREASURY_RECIPIENT?: string;
  DEXTOPUS_DESTINATION_CHAIN_ID?: number;
  DEXTOPUS_DESTINATION_ASSET?: string;
  DEXTOPUS_PARTNER_FEE_RECIPIENT?: string;
  DEXTOPUS_PARTNER_FEE_BPS?: number;
  DEXTOPUS_STATUS_POLL_INTERVAL_MS: number;
  /** Fixed OTP bypass for one allowlisted email; never enable in public production. */
  testOtpBypassEnabled: boolean;
  testOtpEmail: string;
  testOtpCode?: string;
}

function parseOptionalInt(value: string | undefined): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function validateEnv(): EnvConfig {
  const required = ["MONGO_URI", "JWT_SECRET"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }

  const optionalWarn = [
    "FINNHUB_API_KEY",
    "ALPHAVANTAGE_API_KEY",
    "OPENAI_API_KEY",
    "AELLA_SECRET_KEY",
    "DEXTOPUS_TREASURY_RECIPIENT",
    "DEXTOPUS_DESTINATION_CHAIN_ID",
    "DEXTOPUS_DESTINATION_ASSET",
  ];
  optionalWarn.forEach((key) => {
    if (!process.env[key]) {
      console.warn(`⚠️  Optional env var ${key} not set — some features will degrade gracefully.`);
    }
  });

  const rawTestOtpCode = normalizeTestOtpCode(process.env.TEST_OTP_CODE);
  const enableTestOtpFlag = parseEnvTruthy(process.env.ENABLE_TEST_OTP);
  const nodeEnv = process.env.NODE_ENV || "development";
  const testOtpCodeValid =
    !!rawTestOtpCode &&
    rawTestOtpCode.length === AUTH_CONSTANTS.OTP_LENGTH &&
    /^\d+$/.test(rawTestOtpCode);

  if (process.env.TEST_OTP_CODE?.trim() && !testOtpCodeValid) {
    console.warn(
      `⚠️  TEST_OTP_CODE must be exactly ${AUTH_CONSTANTS.OTP_LENGTH} digits — test OTP bypass disabled.`
    );
  }

  const testOtpBypassEnabled = Boolean(
    testOtpCodeValid && (nodeEnv !== "production" || enableTestOtpFlag)
  );

  const testOtpEmail = (
    process.env.TEST_OTP_EMAIL || "signovatest@signova.app"
  )
    .trim()
    .toLowerCase();

  if (enableTestOtpFlag && nodeEnv === "production" && !testOtpBypassEnabled) {
    console.warn(
      "⚠️  ENABLE_TEST_OTP is set but test OTP bypass is off — set TEST_OTP_CODE to exactly 6 digits."
    );
  }

  if (testOtpBypassEnabled) {
    console.log(`[Signova] Test OTP bypass enabled for ${testOtpEmail}`);
  }

  const dextopusDestinationChainId = parseOptionalInt(
    process.env.DEXTOPUS_DESTINATION_CHAIN_ID
  );
  const dextopusPartnerFeeBps = parseOptionalInt(
    process.env.DEXTOPUS_PARTNER_FEE_BPS
  );
  const dextopusStatusPollIntervalMs =
    parseOptionalInt(process.env.DEXTOPUS_STATUS_POLL_INTERVAL_MS) ?? 15000;

  return {
    NODE_ENV: nodeEnv,
    PORT: parseInt(process.env.PORT || "3001", 10),
    MONGO_URI: process.env.MONGO_URI!,
    JWT_SECRET: process.env.JWT_SECRET!,
    FRONTEND_URL: process.env.FRONTEND_URL || "http://localhost:3000",
    FRONTEND_URLS: (process.env.FRONTEND_URLS || process.env.FRONTEND_URL || "http://localhost:3000")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    ADMIN_SERVER_URL:
      process.env.ADMIN_SERVER_URL || "http://localhost:8000",
    SIGNALS_INVALIDATE_SECRET: process.env.SIGNALS_INVALIDATE_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    FCSAPI_KEY: process.env.FCSAPI_KEY,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    FINNHUB_API_KEY: process.env.FINNHUB_API_KEY,
    ALPHAVANTAGE_API_KEY: process.env.ALPHAVANTAGE_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    AELLA_SECRET_KEY: process.env.AELLA_SECRET_KEY,
    DEXTOPUS_BASE_URL:
      process.env.DEXTOPUS_BASE_URL || "https://swap-api.dextopus.com",
    DEXTOPUS_TREASURY_RECIPIENT: process.env.DEXTOPUS_TREASURY_RECIPIENT,
    DEXTOPUS_DESTINATION_CHAIN_ID: dextopusDestinationChainId,
    DEXTOPUS_DESTINATION_ASSET: process.env.DEXTOPUS_DESTINATION_ASSET,
    DEXTOPUS_PARTNER_FEE_RECIPIENT: process.env.DEXTOPUS_PARTNER_FEE_RECIPIENT,
    DEXTOPUS_PARTNER_FEE_BPS: dextopusPartnerFeeBps,
    DEXTOPUS_STATUS_POLL_INTERVAL_MS: dextopusStatusPollIntervalMs,
    testOtpBypassEnabled,
    testOtpEmail,
    testOtpCode: testOtpBypassEnabled ? rawTestOtpCode : undefined,
  };
}

export const env = validateEnv();
