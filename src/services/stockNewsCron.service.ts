import cron, { ScheduledTask } from "node-cron";
import { env } from "../config/env";
import { StockNewsAlertService } from "./stockNewsAlert.service";
import { configuredStockNewsAvailability } from "./stockNewsReadiness.service";

let task: ScheduledTask | null = null;

export function initializeStockNewsCron(): void {
  const availability = configuredStockNewsAvailability();
  if (availability === "disabled") {
    console.log("ℹ️ Stock news alerts are disabled");
    return;
  }
  if (availability === "misconfigured") {
    console.error(
      "❌ Stock news alerts require FINNHUB_API_KEY, OPENAI_API_KEY, and RESEND_API_KEY",
    );
    return;
  }
  if (task) return;
  task = cron.schedule(env.STOCK_NEWS_ALERTS_CRON, async () => {
    try {
      await StockNewsAlertService.run();
    } catch (error) {
      console.error("❌ Stock news alert cron failed:", error);
    }
  });
  console.log(`✅ Stock news alerts scheduled: ${env.STOCK_NEWS_ALERTS_CRON}`);
}

export function stopStockNewsCron(): void {
  task?.destroy();
  task = null;
}
