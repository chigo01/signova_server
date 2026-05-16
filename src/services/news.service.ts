import StocksCache from "../models/stocksCache.model";
import { env } from "../config/env";
import { STOCKS_CONSTANTS } from "../config/constants";

const FINNHUB_BASE = "https://finnhub.io/api/v1";

export interface FinnhubNewsItem {
  id: number;
  category: string;
  datetime: number;
  headline: string;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
}

export interface NewsArticle {
  id: number;
  symbol: string;
  headline: string;
  summary: string;
  source: string;
  url: string;
  image: string;
  datetime: number;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export class FinnhubNewsService {
  static async fetchCompanyNews(symbol: string): Promise<NewsArticle[]> {
    const key = `FH_NEWS:${symbol}`;
    const cached = await this.getCached(key);
    if (cached) return cached as NewsArticle[];

    const to = new Date();
    const from = new Date(to.getTime() - STOCKS_CONSTANTS.NEWS_DAYS_BACK * 24 * 60 * 60 * 1000);
    const url = `${FINNHUB_BASE}/company-news?symbol=${encodeURIComponent(symbol)}&from=${ymd(from)}&to=${ymd(to)}&token=${env.FINNHUB_API_KEY}`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Finnhub company-news failed for ${symbol}: ${res.statusText}`);
    }
    const raw = (await res.json()) as FinnhubNewsItem[];

    const articles: NewsArticle[] = (Array.isArray(raw) ? raw : []).map((n) => ({
      id: n.id,
      symbol,
      headline: n.headline,
      summary: n.summary,
      source: n.source,
      url: n.url,
      image: n.image,
      datetime: n.datetime,
    }));

    await this.setCached(key, articles, STOCKS_CONSTANTS.CACHE_TTL_MINUTES.NEWS);
    return articles;
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
