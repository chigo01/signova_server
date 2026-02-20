import StocksCache from "../models/stocksCache.model";
import { env } from "../config/env";
import { STOCKS_CONSTANTS } from "../config/constants";

const AV_BASE = "https://www.alphavantage.co/query";

export interface AVMover {
  ticker: string;
  price: string;
  change_amount: string;
  change_percentage: string;
  volume: string;
}

export interface AVTopMovers {
  top_gainers: AVMover[];
  top_losers: AVMover[];
  most_actively_traded: AVMover[];
}

export class AlphaVantageService {
  static async fetchTopMovers(): Promise<AVTopMovers> {
    const key = "AV_TOP_MOVERS";
    const cached = await this.getCached(key);
    if (cached) return cached as AVTopMovers;

    const url = `${AV_BASE}?function=TOP_GAINERS_LOSERS&apikey=${env.ALPHAVANTAGE_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Alpha Vantage top movers failed: ${res.statusText}`);
    }
    const data = await res.json();

    if (data["Error Message"] || data["Information"]) {
      throw new Error(
        `Alpha Vantage API error: ${data["Error Message"] || data["Information"]}`
      );
    }

    await this.setCached(key, data, STOCKS_CONSTANTS.CACHE_TTL_MINUTES.TOP_MOVERS);
    return data as AVTopMovers;
  }

  private static async getCached(key: string): Promise<object | null> {
    const doc = await StocksCache.findOne({
      cacheKey: key,
      expiresAt: { $gt: new Date() },
    });
    return doc ? (doc.data as object) : null;
  }

  private static async setCached(
    key: string,
    data: object,
    ttlMinutes: number
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
    await StocksCache.findOneAndUpdate(
      { cacheKey: key },
      { data, fetchedAt: new Date(), expiresAt },
      { upsert: true, returnDocument: "after" }
    );
  }
}
