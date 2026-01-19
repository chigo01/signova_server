export const AUTH_CONSTANTS = {
  OTP_LENGTH: 6,
  OTP_EXPIRY_MINUTES: 10,
  JWT_EXPIRY: "7d",
  JWT_EXPIRY_MS: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
} as const;

export const FCSAPI_CONSTANTS = {
  BASE_URL: "https://api-v4.fcsapi.com/forex/latest",
  CACHE_TTL_MINUTES: 15,
  MONTHLY_LIMIT: 500,
  WARNING_THRESHOLD: 450,
  CORE_PAIRS: [
    "EURUSD",
    "GBPUSD",
    "USDJPY",
    "AUDUSD",
    "USDCAD",
    "USDCHF",
    "NZDUSD",
    "EURJPY",
    "GBPJPY",
    "EURGBP",
    "AUDJPY",
    "NZDJPY",
    "CHFJPY",
    "EURAUD",
    "EURNZD",
    "GBPAUD",
    "GBPCAD",
  ],
} as const;

export const SIGNALS_CONSTANTS = {
  CACHE_TTL_MINUTES: 5, // Cache approved signals for 5 minutes
} as const;

export const PAGINATION_CONSTANTS = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
} as const;
