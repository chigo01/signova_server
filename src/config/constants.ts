export const AUTH_CONSTANTS = {
  OTP_LENGTH: 6,
  OTP_EXPIRY_MINUTES: 10,
  JWT_EXPIRY: "7d",
  JWT_EXPIRY_MS: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
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
    "AMD","PLTR","COIN","SQ","UBER","PYPL","SNOW","CRM","SPY","QQQ","HOOD","SOFI"
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
