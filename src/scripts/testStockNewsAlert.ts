import "dotenv/config";
import mongoose from "mongoose";
import { env } from "../config/env";
import User from "../models/user.model";
import UserWatchlist from "../models/userWatchlist.model";
import { FinnhubNewsService } from "../services/news.service";
import { StockNewsAlertService } from "../services/stockNewsAlert.service";
import { configuredStockNewsAvailability } from "../services/stockNewsReadiness.service";
import { sendEmail } from "../services/email/email.service";
import { deriveFirstName } from "../services/email/templates/_shared";
import { stockNewsImmediateEmail } from "../services/email/templates/stockNews";

/**
 * End-to-end smoke test for the stock news alert pipeline: Finnhub fetch ->
 * OpenAI materiality classifier -> Resend delivery, using the real services and
 * the real email template.
 *
 * Deliberately writes nothing to StockNewsRun / StockNewsArticle /
 * StockNewsDelivery so a test send cannot consume a delivery key, skew the
 * "last checked / last sent" health shown in the app, or suppress a real alert.
 *
 *   pnpm build && pnpm stocknews:test -- --email=admin@example.com --symbol=NVDA
 *
 * --email defaults to the first entry in ADMIN_EMAILS, --symbol to the newest
 * stock on that admin's watchlist.
 */

const HOW_MANY_TO_CLASSIFY = 5;

function readFlag(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length).trim();
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const email = (readFlag(argv, "email") || env.ADMIN_EMAILS[0] || "").toLowerCase();
  if (!email) {
    throw new Error(
      "No recipient. Pass --email=admin@example.com or set ADMIN_EMAILS.",
    );
  }

  const availability = configuredStockNewsAvailability();
  console.log(`[stocknews-test] configured availability: ${availability}`);
  if (availability === "misconfigured") {
    throw new Error(
      "FINNHUB_API_KEY, OPENAI_API_KEY and RESEND_API_KEY must all be set",
    );
  }
  if (availability === "disabled") {
    // Worth sending anyway — this script is exactly how you verify the pipeline
    // before flipping the flag — but the operator should know the cron is off.
    console.warn(
      "[stocknews-test] ⚠️  STOCK_NEWS_ALERTS_ENABLED is not true, so the cron is NOT scheduled. Sending this test anyway.",
    );
  }

  await mongoose.connect(env.MONGO_URI);

  const user = await User.findOne({ email }).select("_id email name").lean();
  if (!user) throw new Error(`No user found for ${email}`);

  let symbol = readFlag(argv, "symbol")?.toUpperCase();
  if (!symbol) {
    const entry = await UserWatchlist.findOne({ userId: user._id })
      .sort({ addedAt: -1 })
      .select("symbol")
      .lean();
    symbol = entry?.symbol;
  }
  if (!symbol) {
    throw new Error(
      `${email} has an empty watchlist — pass --symbol=NVDA to pick one`,
    );
  }
  console.log(`[stocknews-test] recipient=${email} symbol=${symbol}`);

  const news = await FinnhubNewsService.fetchCompanyNewsForAlerts(symbol);
  const usable = news
    .filter((article) => article.headline && article.url && article.source)
    .sort((left, right) => right.datetime - left.datetime);
  if (usable.length === 0) {
    throw new Error(`Finnhub returned no usable articles for ${symbol}`);
  }
  console.log(
    `[stocknews-test] Finnhub returned ${news.length} article(s); newest is ${new Date(
      usable[0].datetime * 1000,
    ).toISOString()}`,
  );

  // Run the real classifier over the newest few and prefer a material one, so
  // the test email shows the same content a live alert would.
  const candidates = usable.slice(0, HOW_MANY_TO_CLASSIFY);
  let chosen: { article: (typeof candidates)[number]; result: Awaited<ReturnType<typeof StockNewsAlertService.classifyMateriality>> } | null =
    null;
  for (const article of candidates) {
    const result = await StockNewsAlertService.classifyMateriality({
      symbols: [symbol],
      headline: article.headline,
      source: article.source,
      sourceSummary: article.summary || "",
    });
    console.log(
      `[stocknews-test] classified material=${result.material} category="${result.category}" — ${article.headline.slice(0, 90)}`,
    );
    if (!chosen) chosen = { article, result };
    if (result.material) {
      chosen = { article, result };
      break;
    }
  }
  if (!chosen) throw new Error("Classifier produced no usable result");
  if (!chosen.result.material) {
    console.warn(
      `[stocknews-test] ⚠️  None of the newest ${candidates.length} articles classified as material; sending the newest one so the delivery path is still exercised.`,
    );
  }

  const message = stockNewsImmediateEmail(deriveFirstName(user.name), {
    symbols: [symbol],
    headline: chosen.article.headline,
    source: chosen.article.source,
    publishedAt: new Date(chosen.article.datetime * 1000),
    summary: chosen.result.summary || chosen.article.summary,
    whyItMatters: chosen.result.whyItMatters,
    url: chosen.article.url,
  });

  await sendEmail({
    to: email,
    subject: `[TEST] ${message.subject}`,
    html: message.html,
  });
  console.log(`[stocknews-test] ✅ Sent to ${email}: ${message.subject}`);
}

void main()
  .catch((error) => {
    console.error("[stocknews-test] Failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
