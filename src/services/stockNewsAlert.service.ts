import { createHash } from "crypto";
import OpenAI from "openai";
import pLimit from "p-limit";
import { env } from "../config/env";
import StockNewsArticle, {
  IStockNewsArticle,
} from "../models/stockNewsArticle.model";
import StockNewsDelivery from "../models/stockNewsDelivery.model";
import StockNewsRun from "../models/stockNewsRun.model";
import User from "../models/user.model";
import { FinnhubNewsService, NewsArticle } from "./news.service";
import { WatchlistService } from "./watchlist.service";
import { deriveFirstName } from "./email/templates/_shared";
import {
  StockNewsEmailArticle,
  stockNewsDigestEmail,
  stockNewsImmediateEmail,
} from "./email/templates/stockNews";
import { sendEmail } from "./email/email.service";
import { runEmailBatch } from "./email/emailBatch.service";

const MAX_CLASSIFICATION_ATTEMPTS = 3;
const MAX_DELIVERY_ATTEMPTS = 3;
const NEWS_FETCH_CONCURRENCY = 5;
const EMAIL_FORMAT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface MaterialityResult {
  material: boolean;
  category: string;
  summary: string;
  whyItMatters: string;
}

interface RecipientContext {
  userId: string;
  email: string;
  firstName: string;
  delivery: "immediate" | "daily";
  timezone: string;
  preferencesChangedAt: Date;
  scheduleEligibleFrom: Date;
  entries: Array<{
    symbol: string;
    alertsActiveSince: Date;
  }>;
}

export function canonicalNewsFingerprint(
  headline: string,
  rawUrl: string,
): string {
  let canonicalUrl = rawUrl.trim();
  try {
    const url = new URL(rawUrl);
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_") || key === "ref" || key === "source") {
        url.searchParams.delete(key);
      }
    }
    url.hash = "";
    canonicalUrl = url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    canonicalUrl = rawUrl.trim().toLowerCase();
  }
  const normalizedHeadline = headline.trim().toLowerCase().replace(/\s+/g, " ");
  return createHash("sha256")
    .update(`${canonicalUrl}|${normalizedHeadline}`)
    .digest("hex");
}

export function localDateAndHour(
  date: Date,
  timeZone: string,
): { localDate: string; hour: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    localDate: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
  };
}

export class StockNewsAlertService {
  private static readonly openai = env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: env.OPENAI_API_KEY })
    : null;

  static async classifyMateriality(
    article: Pick<
      IStockNewsArticle,
      "symbols" | "headline" | "source" | "sourceSummary"
    >,
  ): Promise<MaterialityResult> {
    if (!this.openai) throw new Error("OPENAI_API_KEY is not configured");

    const completion = await this.openai.chat.completions.create({
      model: "gpt-4.1-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Classify company news for a stock watchlist. Material means leadership/governance, earnings or guidance, mergers/financing, legal/regulatory action, major products/partnerships, security/operations incidents, recalls, or another concrete company-impacting event. Routine price recaps, generic market summaries, and opinion pieces are not material. Use only supplied facts. Never predict price direction and never give trading advice. Return JSON with material (boolean), category (short string), summary (1-2 factual sentences), and whyItMatters (1 factual sentence).",
        },
        {
          role: "user",
          content: JSON.stringify({
            symbols: article.symbols,
            headline: article.headline,
            source: article.source,
            sourceSummary: article.sourceSummary,
          }),
        },
      ],
    });
    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error("Materiality classifier returned no content");
    const parsed = JSON.parse(content) as Partial<MaterialityResult>;
    if (
      typeof parsed.material !== "boolean" ||
      typeof parsed.category !== "string" ||
      typeof parsed.summary !== "string" ||
      typeof parsed.whyItMatters !== "string"
    ) {
      throw new Error("Materiality classifier returned an invalid shape");
    }
    return {
      material: parsed.material,
      category: parsed.category.trim().slice(0, 80),
      summary: parsed.summary.trim().slice(0, 1200),
      whyItMatters: parsed.whyItMatters.trim().slice(0, 700),
    };
  }

  static async run(now = new Date()): Promise<void> {
    const startedAt = Date.now();
    const bucketMs = 15 * 60 * 1000;
    const bucket = new Date(Math.floor(now.getTime() / bucketMs) * bucketMs)
      .toISOString()
      .slice(0, 16);

    let runId: string;
    try {
      const run = await StockNewsRun.create({ bucket, status: "running", startedAt: now });
      runId = String(run._id);
    } catch (error) {
      if ((error as { code?: number })?.code === 11000) {
        console.log(`[stock-news] bucket ${bucket} already claimed`);
        return;
      }
      throw error;
    }

    try {
      const recipients = await this.loadRecipients();
      const earliestBySymbol = new Map<string, Date>();
      for (const recipient of recipients) {
        for (const entry of recipient.entries) {
          const cutoff = new Date(
            Math.max(
              entry.alertsActiveSince.getTime(),
              recipient.preferencesChangedAt.getTime(),
            ),
          );
          const current = earliestBySymbol.get(entry.symbol);
          if (!current || cutoff < current) earliestBySymbol.set(entry.symbol, cutoff);
        }
      }

      const articles = await this.discoverArticles(earliestBySymbol);
      const materialArticles = articles.filter(
        (article) => article.materialStatus === "material",
      );
      const jobs: Array<() => Promise<void>> = [];

      for (const recipient of recipients) {
        const eligible = materialArticles.filter((article) =>
          recipient.entries.some(
            (entry) =>
              article.symbols.includes(entry.symbol) &&
              article.publishedAt.getTime() >
                Math.max(
                  entry.alertsActiveSince.getTime(),
                  recipient.preferencesChangedAt.getTime(),
                ),
          ),
        );
        if (eligible.length === 0) continue;

        if (recipient.delivery === "immediate") {
          for (const article of eligible) {
            jobs.push(() => this.deliverImmediate(recipient, article));
          }
        } else {
          const local = localDateAndHour(now, recipient.timezone);
          const eligibleLocal = localDateAndHour(
            recipient.scheduleEligibleFrom,
            recipient.timezone,
          );
          const enabledAfterTodayDeliveryTime =
            eligibleLocal.localDate === local.localDate && eligibleLocal.hour >= 8;
          if (local.hour >= 8 && !enabledAfterTodayDeliveryTime) {
            jobs.push(() =>
              this.deliverDigest(recipient, local.localDate, eligible),
            );
          }
        }
      }

      await runEmailBatch(jobs);
      await StockNewsRun.findByIdAndUpdate(runId, {
        $set: { status: "completed", completedAt: new Date() },
      });
      console.log(
        `[stock-news] bucket=${bucket} users=${recipients.length} symbols=${earliestBySymbol.size} material=${materialArticles.length} jobs=${jobs.length} durationMs=${Date.now() - startedAt}`,
      );
    } catch (error) {
      await StockNewsRun.findByIdAndUpdate(runId, {
        $set: {
          status: "failed",
          completedAt: new Date(),
          error: error instanceof Error ? error.message : String(error),
        },
      });
      console.error(`[stock-news] bucket=${bucket} failed:`, error);
      throw error;
    }
  }

  private static async loadRecipients(): Promise<RecipientContext[]> {
    const users = await User.find({
      "stockNewsPreferences.delivery": { $in: ["immediate", "daily"] },
      email: { $exists: true, $type: "string", $ne: "" },
    }).select("email name stockNewsPreferences plan proPlanExpiry");

    const recipients: RecipientContext[] = [];
    for (const user of users) {
      const reconciled = await WatchlistService.reconcileEntitlements(user._id);
      const entries = reconciled.entries
        .filter((entry) => entry.status === "active")
        .map((entry) => ({
          symbol: entry.symbol,
          alertsActiveSince: entry.alertsActiveSince,
        }));
      if (entries.length === 0) continue;
      const prefs = user.stockNewsPreferences;
      if (!prefs || prefs.delivery === "off") continue;
      const email = user.email.trim().toLowerCase();
      if (!EMAIL_FORMAT_RE.test(email)) continue;
      recipients.push({
        userId: String(user._id),
        email,
        firstName: deriveFirstName(user.name),
        delivery: prefs.delivery,
        timezone: prefs.timezone || "UTC",
        preferencesChangedAt: prefs.changedAt || user.createdAt,
        scheduleEligibleFrom: new Date(
          Math.max(
            (prefs.changedAt || user.createdAt).getTime(),
            ...entries.map((entry) => entry.alertsActiveSince.getTime()),
          ),
        ),
        entries,
      });
    }
    return recipients;
  }

  private static async discoverArticles(
    earliestBySymbol: Map<string, Date>,
  ): Promise<IStockNewsArticle[]> {
    const limit = pLimit(NEWS_FETCH_CONCURRENCY);
    const discovered = await Promise.all(
      [...earliestBySymbol].map(([symbol, earliest]) =>
        limit(async () => {
          try {
            const news = await FinnhubNewsService.fetchCompanyNewsForAlerts(symbol);
            return news.filter(
              (article) =>
                article.headline &&
                article.url &&
                article.source &&
                article.datetime * 1000 > earliest.getTime(),
            );
          } catch (error) {
            console.error(`[stock-news] fetch failed for ${symbol}:`, error);
            return [] as NewsArticle[];
          }
        }),
      ),
    );

    const docs = new Map<string, IStockNewsArticle>();
    for (const article of discovered.flat()) {
      const fingerprint = canonicalNewsFingerprint(article.headline, article.url);
      const doc = await StockNewsArticle.findOneAndUpdate(
        { fingerprint },
        {
          $setOnInsert: {
            fingerprint,
            providerId: String(article.id),
            headline: article.headline,
            source: article.source,
            url: article.url,
            sourceSummary: article.summary || "",
            publishedAt: new Date(article.datetime * 1000),
            materialStatus: "pending",
          },
          $addToSet: { symbols: article.symbol },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      docs.set(String(doc._id), doc);
    }

    for (const doc of docs.values()) {
      if (
        doc.materialStatus !== "pending" &&
        !(doc.materialStatus === "failed" &&
          doc.classificationAttempts < MAX_CLASSIFICATION_ATTEMPTS)
      ) {
        continue;
      }
      try {
        const classification = await this.classifyMateriality(doc);
        doc.materialStatus = classification.material ? "material" : "not_material";
        doc.category = classification.category;
        doc.emailSummary = classification.summary;
        doc.whyItMatters = classification.whyItMatters;
        doc.classificationAttempts += 1;
      } catch (error) {
        doc.materialStatus = "failed";
        doc.classificationAttempts += 1;
        console.error(`[stock-news] classify failed ${doc.fingerprint}:`, error);
      }
      await doc.save();
    }
    return [...docs.values()];
  }

  private static toEmailArticle(
    recipient: RecipientContext,
    article: IStockNewsArticle,
  ): StockNewsEmailArticle {
    const watched = new Set(recipient.entries.map((entry) => entry.symbol));
    return {
      symbols: article.symbols.filter((symbol) => watched.has(symbol)),
      headline: article.headline,
      source: article.source,
      publishedAt: article.publishedAt,
      summary: article.emailSummary || article.sourceSummary,
      whyItMatters: article.whyItMatters || "This is a material company development.",
      url: article.url,
    };
  }

  private static async deliveryCanRun(
    deliveryKey: string,
    userId: string,
    mode: "immediate" | "daily",
    articleIds: string[],
    localDate?: string,
  ) {
    let delivery = await StockNewsDelivery.findOne({ deliveryKey });
    if (!delivery) {
      try {
        delivery = await StockNewsDelivery.create({
          deliveryKey,
          userId,
          mode,
          articleIds,
          localDate,
          status: "pending",
          attempts: 0,
        });
      } catch (error) {
        if ((error as { code?: number })?.code !== 11000) throw error;
        delivery = await StockNewsDelivery.findOne({ deliveryKey });
      }
    }
    if (!delivery || delivery.status === "sent" || delivery.attempts >= MAX_DELIVERY_ATTEMPTS) {
      return null;
    }
    delivery.articleIds = articleIds.map((id) => id as never);
    delivery.status = "pending";
    delivery.attempts += 1;
    await delivery.save();
    return delivery;
  }

  private static async deliverImmediate(
    recipient: RecipientContext,
    article: IStockNewsArticle,
  ): Promise<void> {
    const delivery = await this.deliveryCanRun(
      `immediate:${recipient.userId}:${String(article._id)}`,
      recipient.userId,
      "immediate",
      [String(article._id)],
    );
    if (!delivery) return;
    try {
      const email = stockNewsImmediateEmail(
        recipient.firstName,
        this.toEmailArticle(recipient, article),
      );
      await sendEmail({ to: recipient.email, ...email });
      delivery.status = "sent";
      delivery.sentAt = new Date();
      delivery.lastError = undefined;
    } catch (error) {
      delivery.status = "failed";
      delivery.lastError = error instanceof Error ? error.message : String(error);
    }
    await delivery.save();
  }

  private static async deliverDigest(
    recipient: RecipientContext,
    localDate: string,
    candidates: IStockNewsArticle[],
  ): Promise<void> {
    const previouslySent = await StockNewsDelivery.find({
      userId: recipient.userId,
      status: "sent",
    })
      .select("articleIds")
      .lean();
    const sentIds = new Set(
      previouslySent.flatMap((delivery) =>
        delivery.articleIds.map((id) => String(id)),
      ),
    );
    const articles = candidates.filter(
      (article) => !sentIds.has(String(article._id)),
    );
    if (articles.length === 0) return;

    const delivery = await this.deliveryCanRun(
      `daily:${recipient.userId}:${localDate}`,
      recipient.userId,
      "daily",
      articles.map((article) => String(article._id)),
      localDate,
    );
    if (!delivery) return;
    try {
      const email = stockNewsDigestEmail(
        recipient.firstName,
        localDate,
        articles.map((article) => this.toEmailArticle(recipient, article)),
      );
      await sendEmail({ to: recipient.email, ...email });
      delivery.status = "sent";
      delivery.sentAt = new Date();
      delivery.lastError = undefined;
    } catch (error) {
      delivery.status = "failed";
      delivery.lastError = error instanceof Error ? error.message : String(error);
    }
    await delivery.save();
  }
}
