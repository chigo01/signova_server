export const AUTH_CONSTANTS = {
  OTP_LENGTH: 6,
  OTP_EXPIRY_MINUTES: 10,
  JWT_EXPIRY: "7d",
  JWT_EXPIRY_MS: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
} as const;

export const PROFILE_CONSTANTS = {
  NAME_MAX: 60,
  USERNAME_MIN: 3,
  USERNAME_MAX: 20,
  USERNAME_REGEX: /^[a-z0-9_-]{3,20}$/,
  ROLE_MAX: 60,
  ROLES: [
    "Trader",
    "Active Options Trader",
    "Swing Trader",
    "Analyst",
    "Business Developer",
    "Exchange Rate Analyst",
    "Trade Specialist",
  ] as const,
  AVATAR_MAX_LENGTH: 700_000,
  AVATAR_DATA_URI_REGEX: /^data:image\/(png|jpeg|webp);base64,/,
  PHONE_E164_REGEX: /^\+[1-9]\d{1,14}$/,
  // Pragmatic RFC-lite check: requires local@domain.tld with a 2+ char TLD.
  // Blocks no-TLD typos (e.g. foo@gmail, foo@signova); cannot catch valid-shaped
  // TLD typos like .con/.vom.
  EMAIL_REGEX: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
} as const;

export const ACCOUNT_DELETION_CONSTANTS = {
  // Store policy (Google Play / App Store 5.1.1(v)) allows a grace period so
  // long as deletion is actually initiated in-app and eventually completed.
  GRACE_PERIOD_DAYS: 30,
  REASON_MAX: 500,
  // How many accounts one cron tick may purge. Keeps a backlog from turning a
  // single tick into a multi-minute cascade on the web dyno.
  PURGE_BATCH: 50,
  // A purge that claimed an account but never finished (process restart mid
  // cascade) is reclaimed after this long. Every purge step is idempotent.
  STALE_PURGE_RETRY_MS: 60 * 60 * 1000,
  PLATFORMS: ["web", "ios", "android", "unknown"] as const,
} as const;

export const FCSAPI_CONSTANTS = {
  BASE_URL: "https://api-v4.fcsapi.com/forex/latest",
  HISTORY_URL: "https://api-v4.fcsapi.com/forex/history",
  CACHE_TTL_MINUTES: 15,
  MONTHLY_LIMIT: 500,
  WARNING_THRESHOLD: 450,
  DEFAULT_CANDLES: 100, // Number of historical candles to fetch
  DEFAULT_PERIOD: "1h", // Default timeframe
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

export const STOCKS_CONSTANTS = {
  WATCHLIST: [
    "AAPL","MSFT","NVDA","TSLA","META","AMZN","GOOGL","NFLX",
    "AMD","AVGO","TSM","ARM","MU","SMCI","QCOM","INTC",
    "ORCL","CRM","NOW","SNOW","DDOG","CRWD","NET","MDB",
    "PLTR","COIN","XYZ","PYPL","HOOD","SOFI","MSTR","UBER",
    "LLY","NVO","JPM","GS","COST","WMT","XOM","CVX",
    "DIS","SPOT","RBLX","F","RIVN",
    "SPY","QQQ","IWM","DIA","GLD","TLT"
  ],
  TOP_MOVERS_COUNT: 5,
  CACHE_TTL_MINUTES: {
    QUOTE: 15,
    TECHNICALS: 60,
    PROFILE: 10080,
    TOP_MOVERS: 1440,
    GPT_REC: 60,
    NEWS: 720, // 12 hours
  },
  FINNHUB_CONCURRENCY: 20,
  NEWS_DAYS_BACK: 7, // Fetch news from last 7 days
} as const;
// AV daily usage: 1 call/day (25 call limit → 24 buffer)
