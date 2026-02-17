interface EnvConfig {
  NODE_ENV: string;
  PORT: number;
  MONGO_URI: string;
  JWT_SECRET: string;
  FRONTEND_URL: string;
  ADMIN_SERVER_URL: string;
  RESEND_API_KEY?: string;
  FCSAPI_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
}

function validateEnv(): EnvConfig {
  const required = ["MONGO_URI", "JWT_SECRET"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }

  return {
    NODE_ENV: process.env.NODE_ENV || "development",
    PORT: parseInt(process.env.PORT || "3001", 10),
    MONGO_URI: process.env.MONGO_URI!,
    JWT_SECRET: process.env.JWT_SECRET!,
    FRONTEND_URL: process.env.FRONTEND_URL || "http://localhost:3000",
    ADMIN_SERVER_URL:
      process.env.ADMIN_SERVER_URL || "http://localhost:8000",
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    FCSAPI_KEY: process.env.FCSAPI_KEY,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  };
}

export const env = validateEnv();
