import FcsapiCache from "../models/fcsapiCache.model";
import FcsapiUsage from "../models/fcsapiUsage.model";
import { env } from "../config/env";
import { FCSAPI_CONSTANTS } from "../config/constants";

export interface UsageStats {
  count: number;
  warning: boolean;
}

export interface PairSignalResponse {
  success: boolean;
  pair: string;
  cached: boolean;
  cachedAt: Date;
  expiresAt: Date;
  usage: {
    current: number;
    limit: number;
    warning: boolean;
  };
  signals: any;
}

export class FcsapiService {
  /**
   * Normalize pair format: "EURUSD" -> "EUR/USD"
   */
  static normalizePair(pair: string): string {
    const cleanPair = pair.toUpperCase().replace(/[^A-Z]/g, "");
    if (cleanPair.length === 6) {
      return `${cleanPair.slice(0, 3)}/${cleanPair.slice(3)}`;
    }
    return cleanPair;
  }

  /**
   * Validate if pair is supported
   */
  static isValidPair(pair: string): boolean {
    const cleanPair = pair.toUpperCase().replace(/[^A-Z]/g, "");
    return (FCSAPI_CONSTANTS.CORE_PAIRS as readonly string[]).includes(
      cleanPair
    );
  }

  /**
   * Get current month key: "2026-01"
   */
  private static getCurrentMonthKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  /**
   * Increment usage counter and return current count
   */
  private static async incrementUsage(): Promise<UsageStats> {
    const monthKey = this.getCurrentMonthKey();

    const usage = await FcsapiUsage.findOneAndUpdate(
      { month: monthKey },
      {
        $inc: { count: 1 },
        $set: { lastUpdated: new Date() },
      },
      { upsert: true, new: true }
    );

    return {
      count: usage.count,
      warning: usage.count >= FCSAPI_CONSTANTS.WARNING_THRESHOLD,
    };
  }

  /**
   * Get current usage without incrementing
   */
  static async getCurrentUsage(): Promise<UsageStats> {
    const monthKey = this.getCurrentMonthKey();
    const usage = await FcsapiUsage.findOne({ month: monthKey });

    const count = usage?.count || 0;
    return {
      count,
      warning: count >= FCSAPI_CONSTANTS.WARNING_THRESHOLD,
    };
  }

  /**
   * Get cached signal for a pair if available and not expired
   */
  private static async getCachedSignal(
    pair: string
  ): Promise<{ signals: any; fetchedAt: Date; expiresAt: Date } | null> {
    const now = new Date();
    const cached = await FcsapiCache.findOne({
      pair,
      expiresAt: { $gt: now },
    });

    if (!cached) return null;

    return {
      signals: cached.signals,
      fetchedAt: cached.fetchedAt,
      expiresAt: cached.expiresAt,
    };
  }

  /**
   * Fetch fresh signal data from fcsapi
   */
  private static async fetchFromApi(cleanPair: string): Promise<any> {
    if (!env.FCSAPI_KEY) {
      throw new Error("FCSAPI_KEY is not configured");
    }

    const apiUrl = `${FCSAPI_CONSTANTS.BASE_URL}?symbol=${cleanPair}&period=1w&access_key=${env.FCSAPI_KEY}`;
    console.log("Calling fcsapi:", apiUrl.replace(env.FCSAPI_KEY, "***"));

    const response = await fetch(apiUrl);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("fcsapi error:", errorText);
      throw new Error(`Failed to fetch from fcsapi: ${errorText}`);
    }

    return await response.json();
  }

  /**
   * Cache signal data for a pair
   */
  private static async cacheSignal(
    pair: string,
    signals: any
  ): Promise<{ fetchedAt: Date; expiresAt: Date }> {
    const fetchedAt = new Date();
    const expiresAt = new Date(
      fetchedAt.getTime() + FCSAPI_CONSTANTS.CACHE_TTL_MINUTES * 60 * 1000
    );

    await FcsapiCache.findOneAndUpdate(
      { pair },
      {
        pair,
        signals,
        fetchedAt,
        expiresAt,
      },
      { upsert: true, new: true }
    );

    return { fetchedAt, expiresAt };
  }

  /**
   * Get signal data for a pair (from cache or API)
   */
  static async getPairSignal(pair: string): Promise<PairSignalResponse> {
    const normalizedPair = this.normalizePair(pair);

    // Check cache first
    const cached = await this.getCachedSignal(normalizedPair);
    if (cached) {
      const usage = await this.getCurrentUsage();
      return {
        success: true,
        pair: normalizedPair,
        cached: true,
        cachedAt: cached.fetchedAt,
        expiresAt: cached.expiresAt,
        usage: {
          current: usage.count,
          limit: FCSAPI_CONSTANTS.MONTHLY_LIMIT,
          warning: usage.warning,
        },
        signals: cached.signals,
      };
    }

    // Fetch from API
    const cleanPair = pair.toUpperCase().replace(/[^A-Z]/g, "");
    const signals = await this.fetchFromApi(cleanPair);

    // Increment usage counter
    const usage = await this.incrementUsage();

    // Log warning if threshold exceeded
    if (usage.warning) {
      console.warn(
        `⚠️ fcsapi usage warning: ${usage.count}/${FCSAPI_CONSTANTS.MONTHLY_LIMIT} requests used this month`
      );
    }

    // Cache the response
    const { fetchedAt, expiresAt } = await this.cacheSignal(
      normalizedPair,
      signals
    );

    return {
      success: true,
      pair: normalizedPair,
      cached: false,
      cachedAt: fetchedAt,
      expiresAt,
      usage: {
        current: usage.count,
        limit: FCSAPI_CONSTANTS.MONTHLY_LIMIT,
        warning: usage.warning,
      },
      signals,
    };
  }

  /**
   * Get usage statistics for current month
   */
  static async getUsageStats() {
    const usage = await this.getCurrentUsage();
    const monthKey = this.getCurrentMonthKey();

    return {
      success: true,
      month: monthKey,
      usage: {
        current: usage.count,
        limit: FCSAPI_CONSTANTS.MONTHLY_LIMIT,
        remaining: FCSAPI_CONSTANTS.MONTHLY_LIMIT - usage.count,
        percentUsed: Math.round(
          (usage.count / FCSAPI_CONSTANTS.MONTHLY_LIMIT) * 100
        ),
        warning: usage.warning,
      },
    };
  }
}
