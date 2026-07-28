import { env } from "../config/env";

export type StockNewsAvailability =
  | "scheduled"
  | "disabled"
  | "misconfigured";

export interface StockNewsReadinessConfig {
  enabled: boolean;
  finnhubApiKey?: string;
  openaiApiKey?: string;
  resendApiKey?: string;
}

export function stockNewsAvailability(
  config: StockNewsReadinessConfig,
): StockNewsAvailability {
  if (!config.enabled) return "disabled";
  if (!config.finnhubApiKey || !config.openaiApiKey || !config.resendApiKey) {
    return "misconfigured";
  }
  return "scheduled";
}

export function configuredStockNewsAvailability(): StockNewsAvailability {
  return stockNewsAvailability({
    enabled: env.STOCK_NEWS_ALERTS_ENABLED,
    finnhubApiKey: env.FINNHUB_API_KEY,
    openaiApiKey: env.OPENAI_API_KEY,
    resendApiKey: env.RESEND_API_KEY,
  });
}
