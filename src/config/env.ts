interface EnvConfig {
  NODE_ENV: string;
  PORT: number;
  MONGO_URI: string;
  JWT_SECRET: string;
  FRONTEND_URL: string;
  FRONTEND_URLS: string[];
  ADMIN_SERVER_URL: string;
  RESEND_API_KEY?: string;
  FCSAPI_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  FINNHUB_API_KEY?: string;
  ALPHAVANTAGE_API_KEY?: string;
  OPENAI_API_KEY?: string;
  AELLA_SECRET_KEY?: string;
}

function validateEnv(): EnvConfig {
  const required = ["MONGO_URI", "JWT_SECRET"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }

  const optionalWarn = ["FINNHUB_API_KEY", "ALPHAVANTAGE_API_KEY", "OPENAI_API_KEY", "AELLA_SECRET_KEY"];
  optionalWarn.forEach((key) => {
    if (!process.env[key]) {
      console.warn(`⚠️  Optional env var ${key} not set — some features will degrade gracefully.`);
    }
  });

  return {
    NODE_ENV: process.env.NODE_ENV || "development",
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
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    FCSAPI_KEY: process.env.FCSAPI_KEY,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    FINNHUB_API_KEY: process.env.FINNHUB_API_KEY,
    ALPHAVANTAGE_API_KEY: process.env.ALPHAVANTAGE_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    AELLA_SECRET_KEY: process.env.AELLA_SECRET_KEY,
  };
}

export const env = validateEnv();
