import { ACCOUNT_DELETION_CONSTANTS, AUTH_CONSTANTS } from "./constants";

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
  /** Lowercased emails allowed to access the affiliate admin endpoints. */
  ADMIN_EMAILS: string[];
  SIGNALS_INVALIDATE_SECRET?: string;
  SIGNALS_ALERT_SECRET?: string;
  /** Shared secret sent to admin-server when reading approved/elite signals. */
  SIGNALS_READ_SECRET?: string;
  RESEND_API_KEY?: string;
  FCSAPI_KEY?: string;
  /** OAuth client IDs whose Google tokens may authenticate with Signova. */
  GOOGLE_CLIENT_IDS: string[];
  /** @deprecated Prefer GOOGLE_CLIENT_IDS; retained for deployment compatibility. */
  GOOGLE_CLIENT_ID?: string;
  APPLE_TEAM_ID?: string;
  APPLE_KEY_ID?: string;
  APPLE_PRIVATE_KEY_BASE64?: string;
  APPLE_IOS_CLIENT_ID?: string;
  APPLE_SERVICE_CLIENT_ID?: string;
  APPLE_REDIRECT_URI?: string;
  APPLE_TOKEN_ENCRYPTION_KEY?: string;
  FINNHUB_API_KEY?: string;
  ALPHAVANTAGE_API_KEY?: string;
  OPENAI_API_KEY?: string;
  STOCK_NEWS_ALERTS_ENABLED: boolean;
  STOCK_NEWS_ALERTS_CRON: string;
  ANTHROPIC_API_KEY?: string;
  FIREBASE_PUSH_ENABLED: boolean;
  FIREBASE_PROJECT_ID: string;
  PAYSTACK_SECRET_KEY: string;
  PAYSTACK_CALLBACK_URL?: string;
  BACHS_API_KEY?: string;
  BACHS_BASE_URL: string;
  BACHS_WEBHOOK_SECRET?: string;
  BACHS_CALLBACK_URL?: string;
  DEXTOPUS_BASE_URL: string;
  DEXTOPUS_API_KEY?: string;
  DEXTOPUS_TREASURY_RECIPIENT?: string;
  DEXTOPUS_DESTINATION_CHAIN_ID?: number;
  DEXTOPUS_DESTINATION_ASSET?: string;
  DEXTOPUS_PARTNER_FEE_RECIPIENT?: string;
  DEXTOPUS_PARTNER_FEE_BPS?: number;
  DEXTOPUS_STATUS_POLL_INTERVAL_MS: number;
  /** Days between an account deletion request and the irreversible purge. */
  ACCOUNT_DELETION_GRACE_DAYS: number;
  ACCOUNT_DELETION_PURGE_CRON: string;
  /** Kill switch for the purge cron; requests and revocations keep working. */
  ACCOUNT_DELETION_PURGE_ENABLED: boolean;
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
  const required = ["MONGO_URI", "JWT_SECRET", "PAYSTACK_SECRET_KEY"];
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
    "ANTHROPIC_API_KEY",
    "PAYSTACK_CALLBACK_URL",
    "BACHS_API_KEY",
    "DEXTOPUS_API_KEY",
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

  const bachsApiKey = process.env.BACHS_API_KEY?.trim() || undefined;
  const bachsBaseUrl =
    process.env.BACHS_BASE_URL?.trim() ||
    (bachsApiKey?.startsWith("sk_live_")
      ? "https://api.bachs.io"
      : "https://sandbox-api.bachs.io");
  if (bachsApiKey && !process.env.BACHS_WEBHOOK_SECRET?.trim()) {
    console.warn(
      "⚠️  BACHS_API_KEY is set but BACHS_WEBHOOK_SECRET is missing — Bachs webhooks will be rejected."
    );
  }

  // Grace days must stay positive — a zero or negative value would schedule the
  // purge in the past and delete an account the instant it is requested.
  const configuredGraceDays = parseOptionalInt(
    process.env.ACCOUNT_DELETION_GRACE_DAYS
  );
  const accountDeletionGraceDays =
    configuredGraceDays != null && configuredGraceDays > 0
      ? configuredGraceDays
      : ACCOUNT_DELETION_CONSTANTS.GRACE_PERIOD_DAYS;
  if (configuredGraceDays != null && configuredGraceDays <= 0) {
    console.warn(
      `⚠️  ACCOUNT_DELETION_GRACE_DAYS must be a positive integer — falling back to ${accountDeletionGraceDays}.`
    );
  }
  // Defaults ON: an account deletion feature that never actually deletes would
  // put us right back out of store compliance. Set to "false" to pause it.
  const accountDeletionPurgeEnabled =
    process.env.ACCOUNT_DELETION_PURGE_ENABLED == null ||
    process.env.ACCOUNT_DELETION_PURGE_ENABLED.trim() === ""
      ? true
      : parseEnvTruthy(process.env.ACCOUNT_DELETION_PURGE_ENABLED);
  const googleClientIds = Array.from(
    new Set(
      [
        process.env.GOOGLE_CLIENT_ID,
        ...(process.env.GOOGLE_CLIENT_IDS || "").split(","),
      ]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
    )
  );

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
    ADMIN_EMAILS: (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    SIGNALS_INVALIDATE_SECRET: process.env.SIGNALS_INVALIDATE_SECRET,
    SIGNALS_ALERT_SECRET: process.env.SIGNALS_ALERT_SECRET,
    SIGNALS_READ_SECRET: process.env.SIGNALS_READ_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    FCSAPI_KEY: process.env.FCSAPI_KEY,
    GOOGLE_CLIENT_IDS: googleClientIds,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    APPLE_TEAM_ID: process.env.APPLE_TEAM_ID,
    APPLE_KEY_ID: process.env.APPLE_KEY_ID,
    APPLE_PRIVATE_KEY_BASE64: process.env.APPLE_PRIVATE_KEY_BASE64,
    APPLE_IOS_CLIENT_ID: process.env.APPLE_IOS_CLIENT_ID,
    APPLE_SERVICE_CLIENT_ID: process.env.APPLE_SERVICE_CLIENT_ID,
    APPLE_REDIRECT_URI: process.env.APPLE_REDIRECT_URI,
    APPLE_TOKEN_ENCRYPTION_KEY: process.env.APPLE_TOKEN_ENCRYPTION_KEY,
    FINNHUB_API_KEY: process.env.FINNHUB_API_KEY,
    ALPHAVANTAGE_API_KEY: process.env.ALPHAVANTAGE_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    STOCK_NEWS_ALERTS_ENABLED: parseEnvTruthy(
      process.env.STOCK_NEWS_ALERTS_ENABLED,
    ),
    STOCK_NEWS_ALERTS_CRON:
      process.env.STOCK_NEWS_ALERTS_CRON || "*/15 * * * *",
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    FIREBASE_PUSH_ENABLED: parseEnvTruthy(process.env.FIREBASE_PUSH_ENABLED),
    FIREBASE_PROJECT_ID:
      process.env.FIREBASE_PROJECT_ID || "signova-f7c94",
    PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY!,
    PAYSTACK_CALLBACK_URL: process.env.PAYSTACK_CALLBACK_URL,
    BACHS_API_KEY: bachsApiKey,
    BACHS_BASE_URL: bachsBaseUrl.replace(/\/$/, ""),
    BACHS_WEBHOOK_SECRET: process.env.BACHS_WEBHOOK_SECRET?.trim() || undefined,
    BACHS_CALLBACK_URL: process.env.BACHS_CALLBACK_URL?.trim() || undefined,
    DEXTOPUS_BASE_URL:
      process.env.DEXTOPUS_BASE_URL || "https://swap-api.dextopus.com",
    DEXTOPUS_API_KEY: process.env.DEXTOPUS_API_KEY?.trim() || undefined,
    DEXTOPUS_TREASURY_RECIPIENT: process.env.DEXTOPUS_TREASURY_RECIPIENT,
    DEXTOPUS_DESTINATION_CHAIN_ID: dextopusDestinationChainId,
    DEXTOPUS_DESTINATION_ASSET: process.env.DEXTOPUS_DESTINATION_ASSET,
    DEXTOPUS_PARTNER_FEE_RECIPIENT: process.env.DEXTOPUS_PARTNER_FEE_RECIPIENT,
    DEXTOPUS_PARTNER_FEE_BPS: dextopusPartnerFeeBps,
    DEXTOPUS_STATUS_POLL_INTERVAL_MS: dextopusStatusPollIntervalMs,
    ACCOUNT_DELETION_GRACE_DAYS: accountDeletionGraceDays,
    ACCOUNT_DELETION_PURGE_CRON:
      process.env.ACCOUNT_DELETION_PURGE_CRON || "20 3 * * *",
    ACCOUNT_DELETION_PURGE_ENABLED: accountDeletionPurgeEnabled,
    testOtpBypassEnabled,
    testOtpEmail,
    testOtpCode: testOtpBypassEnabled ? rawTestOtpCode : undefined,
  };
}

export const env = validateEnv();
