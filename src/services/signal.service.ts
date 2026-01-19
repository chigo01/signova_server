import SignalPlay from "../models/signalPlay.model";
import SignalsCache from "../models/signalsCache.model";
import { env } from "../config/env";
import { PAGINATION_CONSTANTS, SIGNALS_CONSTANTS } from "../config/constants";

export interface PlaySignalData {
  userId: any;
  signalId: string;
  symbol: string;
  signalType: "buy" | "sell";
  entryPrice: number;
  targetPrice?: number;
  stopLoss?: number;
}

const SIGNALS_CACHE_KEY = "approved-signals";

export class SignalService {
  /**
   * Get cached signals if available and not expired
   */
  private static async getCachedSignals(): Promise<any | null> {
    const now = new Date();
    const cached = await SignalsCache.findOne({
      cacheKey: SIGNALS_CACHE_KEY,
      expiresAt: { $gt: now },
    });

    if (!cached) return null;

    console.log(
      `Using cached signals (expires at ${cached.expiresAt.toISOString()})`
    );
    return {
      ...cached.signals,
      cached: true,
      cachedAt: cached.fetchedAt,
      expiresAt: cached.expiresAt,
    };
  }

  /**
   * Fetch fresh signals from admin server
   */
  private static async fetchFromAdminServer(): Promise<any> {
    console.log("Fetching fresh signals from admin server...");
    const response = await fetch(`${env.ADMIN_SERVER_URL}/approved-signals`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Admin server error:", errorText);
      throw new Error(
        `Failed to fetch signals from admin server: ${errorText}`
      );
    }

    return await response.json();
  }

  /**
   * Cache signals data
   */
  private static async cacheSignals(signals: any): Promise<void> {
    const fetchedAt = new Date();
    const expiresAt = new Date(
      fetchedAt.getTime() + SIGNALS_CONSTANTS.CACHE_TTL_MINUTES * 60 * 1000
    );

    await SignalsCache.findOneAndUpdate(
      { cacheKey: SIGNALS_CACHE_KEY },
      {
        cacheKey: SIGNALS_CACHE_KEY,
        signals,
        fetchedAt,
        expiresAt,
      },
      { upsert: true, new: true }
    );

    console.log(`Signals cached until ${expiresAt.toISOString()}`);
  }

  /**
   * Fetch approved signals from admin server (with caching)
   */
  static async getApprovedSignals(): Promise<any> {
    // Check cache first
    const cached = await this.getCachedSignals();
    if (cached) {
      return cached;
    }

    // Fetch from admin server
    const signals = await this.fetchFromAdminServer();

    // Cache the response
    await this.cacheSignals(signals);

    return signals;
  }

  /**
   * Save a signal play for a user
   */
  static async playSignal(data: PlaySignalData) {
    const signalPlay = new SignalPlay({
      userId: data.userId,
      signalId: data.signalId,
      symbol: data.symbol,
      signalType: data.signalType,
      entryPrice: data.entryPrice,
      targetPrice: data.targetPrice,
      stopLoss: data.stopLoss,
      playedAt: new Date(),
    });

    await signalPlay.save();
    return signalPlay;
  }

  /**
   * Get signal history for a user with pagination
   */
  static async getSignalHistory(userId: any, page?: number, limit?: number) {
    const currentPage = page || PAGINATION_CONSTANTS.DEFAULT_PAGE;
    const currentLimit = limit || PAGINATION_CONSTANTS.DEFAULT_LIMIT;
    const skip = (currentPage - 1) * currentLimit;

    const [history, total] = await Promise.all([
      SignalPlay.find({ userId })
        .sort({ playedAt: -1 })
        .skip(skip)
        .limit(currentLimit)
        .lean(),
      SignalPlay.countDocuments({ userId }),
    ]);

    return {
      data: history,
      pagination: {
        page: currentPage,
        limit: currentLimit,
        total,
        totalPages: Math.ceil(total / currentLimit),
      },
    };
  }
}
