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

const SIGNALS_CACHE_KEY = "elite-signals-v2";

/** Page size when scanning full approved history (e.g. win rate). */
const APPROVED_HISTORY_AGG_PAGE_SIZE = 100000000;

export class SignalService {
  /**
   * Headers for server-to-server reads against admin-server. admin-server
   * gates the approved/elite signal endpoints behind a shared secret (audit
   * C1); send it in `x-service-secret` when configured. When unset (e.g. local
   * dev against an unsecured admin-server) the header is simply omitted.
   */
  private static adminReadHeaders(): Record<string, string> {
    return env.SIGNALS_READ_SECRET
      ? { "x-service-secret": env.SIGNALS_READ_SECRET }
      : {};
  }

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

    if (!this.shouldCacheSignals(cached.signals)) {
      await SignalsCache.deleteOne({ _id: cached._id });
      return null;
    }

    console.log(
      `✅ Using cached signals (expires at ${cached.expiresAt.toISOString()})`,
    );

    // Return the signals data directly (it's already the full response object)
    return cached.signals;
  }

  /**
   * Fetch fresh signals from admin server
   */
  private static async fetchFromAdminServer(): Promise<any> {
    console.log("Fetching fresh elite signals from admin server...");
    const headers = this.adminReadHeaders();
    const response = await fetch(`${env.ADMIN_SERVER_URL}/signals/elite`, {
      headers,
    });

    if (!response.ok) {
      const eliteErrorText = await response.text();
      console.warn("Admin elite endpoint unavailable, falling back:", eliteErrorText);
      const fallbackResponse = await fetch(
        `${env.ADMIN_SERVER_URL}/approved-signals`,
        { headers },
      );

      if (!fallbackResponse.ok) {
        const errorText = await fallbackResponse.text();
        console.error("Admin server error:", errorText);
        throw new Error(
          `Failed to fetch signals from admin server: ${errorText}`,
        );
      }

      return await fallbackResponse.json();
    }

    return await response.json();
  }

  /**
   * Delete the cached approved-signals doc so the next read repopulates.
   * Called from the invalidation webhook when admin-server mutates a signal.
   */
  public static async invalidateApprovedCache(): Promise<void> {
    await SignalsCache.deleteOne({ cacheKey: SIGNALS_CACHE_KEY });
  }

  /**
   * Cache signals data
   */
  private static async cacheSignals(signals: any): Promise<void> {
    const fetchedAt = new Date();
    const expiresAt = new Date(
      fetchedAt.getTime() + SIGNALS_CONSTANTS.CACHE_TTL_MINUTES * 60 * 1000,
    );

    await SignalsCache.findOneAndUpdate(
      { cacheKey: SIGNALS_CACHE_KEY },
      {
        cacheKey: SIGNALS_CACHE_KEY,
        signals,
        fetchedAt,
        expiresAt,
      },
      { upsert: true, new: true },
    );

    console.log(`Signals cached until ${expiresAt.toISOString()}`);
  }

  private static shouldCacheSignals(signals: any): boolean {
    const approvedCount = Array.isArray(signals?.signals)
      ? signals.signals.length
      : Number(signals?.count) || 0;

    return approvedCount > 0;
  }

  /**
   * Fetch approved signals from admin server (with caching)
   */
  static async getApprovedSignals(): Promise<any> {
    try {
      const cachedSignals = await this.getCachedSignals();
      if (cachedSignals) {
        return cachedSignals;
      }

      // Fetch from admin server
      console.log("📡 Fetching fresh signals from admin server...");
      const signals = await this.fetchFromAdminServer();

      // Cache the response
      if (this.shouldCacheSignals(signals)) {
        await this.cacheSignals(signals);
      }

      return signals;
    } catch (error) {
      console.error("❌ Error in getApprovedSignals:", error);
      throw error;
    }
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

  /*
   * User played-signal history (Mongo SignalPlay) — kept for possible future use.
   * Requires userId from the controller: getSignalHistory(userId, page, limit).
   *
   * static async getUserPlayedSignalHistory(userId: any, page?: number, limit?: number) {
   *   const currentPage = page || PAGINATION_CONSTANTS.DEFAULT_PAGE;
   *   const currentLimit = limit || PAGINATION_CONSTANTS.DEFAULT_LIMIT;
   *   const skip = (currentPage - 1) * currentLimit;
   *
   *   const [history, total] = await Promise.all([
   *     SignalPlay.find({ userId })
   *       .sort({ playedAt: -1 })
   *       .skip(skip)
   *       .limit(currentLimit)
   *       .lean(),
   *     SignalPlay.countDocuments({ userId }),
   *   ]);
   *
   *   return {
   *     data: history,
   *     pagination: {
   *       page: currentPage,
   *       limit: currentLimit,
   *       total,
   *       totalPages: Math.ceil(total / currentLimit),
   *     },
   *   };
   * }
   */

  private static async fetchApprovedSignalsHistoryPage(
    page: number,
    limit: number,
  ): Promise<any> {
    const url = new URL(`${env.ADMIN_SERVER_URL}/approved-signals/history`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", String(limit));

    const response = await fetch(url.toString(), {
      headers: this.adminReadHeaders(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        "Admin server error (approved-signals/history):",
        errorText,
      );
      throw new Error(
        `Failed to fetch approved signals history from admin: ${errorText}`,
      );
    }

    return await response.json();
  }

  /**
   * Paginated admin-approved signal history (proxied from admin server).
   */
  static async getSignalHistory(page?: number, limit?: number) {
    const currentPage =
      page != null && Number.isFinite(page) && page > 0
        ? page
        : PAGINATION_CONSTANTS.DEFAULT_PAGE;
    const currentLimit =
      limit != null && Number.isFinite(limit) && limit > 0
        ? limit
        : PAGINATION_CONSTANTS.DEFAULT_LIMIT;

    return this.fetchApprovedSignalsHistoryPage(currentPage, currentLimit);
  }

  /**
   * Win rate from full approved history: final take-profit outcomes / total approved signals (%).
   */
  static async getApprovedSignalsWinRate(): Promise<{
    winRate: number;
    totalSignals: number;
    takeProfitHits: number;
  }> {
    let takeProfitHits = 0;
    let totalSignals = 0;
    let page = 1;
    let totalPages = 1;

    do {
      const data = await this.fetchApprovedSignalsHistoryPage(
        page,
        APPROVED_HISTORY_AGG_PAGE_SIZE,
      );
      const items: any[] = Array.isArray(data?.items) ? data.items : [];
      for (const item of items) {
        totalSignals += 1;
        if (
          item?.signal?.tradeOutcome === "TP_HIT" ||
          item?.signal?.tradeOutcome === "TP2_HIT"
        ) {
          takeProfitHits += 1;
        }
      }
      totalPages = Math.max(
        1,
        Number(data?.pagination?.totalPages) || 1,
      );
      page += 1;
    } while (page <= totalPages);

    const winRate =
      totalSignals === 0
        ? 0
        : Math.round((takeProfitHits / totalSignals) * 10000) / 100;

    return { winRate, totalSignals, takeProfitHits };
  }
}
