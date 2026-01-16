import { Request, Response } from "express";
import FcsapiCache from "../models/fcsapiCache.model";
import FcsapiUsage from "../models/fcsapiUsage.model";

const FCSAPI_BASE_URL = "https://fcsapi.com/api-v3/forex/ma_avg";
const FCSAPI_KEY = process.env.FCSAPI_KEY;
const CACHE_TTL_MINUTES = 15;
const MONTHLY_LIMIT = 500;
const WARNING_THRESHOLD = 450;

const CORE_PAIRS = [
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
];

// Normalize pair format: "EURUSD" -> "EUR/USD"
const normalizePair = (pair: string): string => {
  const cleanPair = pair.toUpperCase().replace(/[^A-Z]/g, "");
  if (cleanPair.length === 6) {
    return `${cleanPair.slice(0, 3)}/${cleanPair.slice(3)}`;
  }
  return cleanPair;
};

// Get current month key: "2026-01"
const getCurrentMonthKey = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};

// Increment usage counter and return current count
const incrementUsage = async (): Promise<{
  count: number;
  warning: boolean;
}> => {
  const monthKey = getCurrentMonthKey();

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
    warning: usage.count >= WARNING_THRESHOLD,
  };
};

// Get current usage without incrementing
const getCurrentUsage = async (): Promise<{
  count: number;
  warning: boolean;
}> => {
  const monthKey = getCurrentMonthKey();
  const usage = await FcsapiUsage.findOne({ month: monthKey });

  const count = usage?.count || 0;
  return {
    count,
    warning: count >= WARNING_THRESHOLD,
  };
};

export const getPairSignal = async (req: Request, res: Response) => {
  try {
    const { pair } = req.params;

    if (!pair) {
      res.status(400).json({
        success: false,
        message: "Pair parameter is required",
      });
      return;
    }

    // Normalize and validate pair
    const cleanPair = pair.toUpperCase().replace(/[^A-Z]/g, "");
    if (!CORE_PAIRS.includes(cleanPair)) {
      res.status(400).json({
        success: false,
        message: `Invalid pair. Supported pairs: ${CORE_PAIRS.join(", ")}`,
      });
      return;
    }

    const normalizedPair = normalizePair(cleanPair);

    // Check cache first
    const now = new Date();
    const cached = await FcsapiCache.findOne({
      pair: normalizedPair,
      expiresAt: { $gt: now },
    });

    if (cached) {
      const usage = await getCurrentUsage();
      res.status(200).json({
        success: true,
        pair: normalizedPair,
        cached: true,
        cachedAt: cached.fetchedAt,
        expiresAt: cached.expiresAt,
        usage: {
          current: usage.count,
          limit: MONTHLY_LIMIT,
          warning: usage.warning,
        },
        signals: cached.signals,
      });
      return;
    }

    // Validate API key
    if (!FCSAPI_KEY) {
      res.status(500).json({
        success: false,
        message: "FCSAPI_KEY is not configured",
      });
      return;
    }

    // Call fcsapi ma_avg (moving average) endpoint for signals
    const apiUrl = `${FCSAPI_BASE_URL}?symbol=${cleanPair}&period=1h&access_key=${FCSAPI_KEY}`;
    console.log("Calling fcsapi:", apiUrl.replace(FCSAPI_KEY!, "***"));
    const response = await fetch(apiUrl);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("fcsapi error:", errorText);
      res.status(response.status).json({
        success: false,
        message: "Failed to fetch signals from fcsapi",
        error: errorText,
      });
      return;
    }

    const data = await response.json();

    // Increment usage counter
    const usage = await incrementUsage();

    // Log warning if threshold exceeded
    if (usage.warning) {
      console.warn(
        `⚠️ fcsapi usage warning: ${usage.count}/${MONTHLY_LIMIT} requests used this month`
      );
    }

    // Cache the response
    const fetchedAt = new Date();
    const expiresAt = new Date(
      fetchedAt.getTime() + CACHE_TTL_MINUTES * 60 * 1000
    );

    await FcsapiCache.findOneAndUpdate(
      { pair: normalizedPair },
      {
        pair: normalizedPair,
        signals: data,
        fetchedAt,
        expiresAt,
      },
      { upsert: true, new: true }
    );

    res.status(200).json({
      success: true,
      pair: normalizedPair,
      cached: false,
      cachedAt: fetchedAt,
      expiresAt,
      usage: {
        current: usage.count,
        limit: MONTHLY_LIMIT,
        warning: usage.warning,
      },
      signals: data,
    });
  } catch (error) {
    console.error("Error fetching pair signal:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// Get current monthly usage stats
export const getUsageStats = async (_req: Request, res: Response) => {
  try {
    const usage = await getCurrentUsage();
    const monthKey = getCurrentMonthKey();

    res.status(200).json({
      success: true,
      month: monthKey,
      usage: {
        current: usage.count,
        limit: MONTHLY_LIMIT,
        remaining: MONTHLY_LIMIT - usage.count,
        percentUsed: Math.round((usage.count / MONTHLY_LIMIT) * 100),
        warning: usage.warning,
      },
    });
  } catch (error) {
    console.error("Error fetching usage stats:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
