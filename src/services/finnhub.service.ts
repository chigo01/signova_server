import StocksCache from "../models/stocksCache.model";
import { env } from "../config/env";
import { STOCKS_CONSTANTS } from "../config/constants";

const FINNHUB_BASE = "https://finnhub.io/api/v1";

export interface FinnhubQuote {
  c: number;  // current price
  d: number;  // change
  dp: number; // change percent
  h: number;  // high
  l: number;  // low
  o: number;  // open
  pc: number; // previous close
}

export interface FinnhubTechnicals {
  technicalAnalysis: {
    count: { buy: number; neutral: number; sell: number };
    signal: "buy" | "sell" | "neutral";
  };
  trend: {
    adx: number;
    trending: boolean;
  };
}

export interface FinnhubProfile {
  name: string;
  finnhubIndustry: string;
  marketCapitalization: number;
}

export class FinnhubService {
  static async fetchQuote(symbol: string): Promise<FinnhubQuote> {
    const key = `FH_QUOTE:${symbol}`;
    const cached = await this.getCached(key);
    if (cached) return cached as FinnhubQuote;

    const url = `${FINNHUB_BASE}/quote?symbol=${symbol}&token=${env.FINNHUB_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Finnhub quote failed for ${symbol}: ${res.statusText}`);
    }
    const data = await res.json();
    await this.setCached(key, data, STOCKS_CONSTANTS.CACHE_TTL_MINUTES.QUOTE);
    return data as FinnhubQuote;
  }

  static async fetchTechnicals(symbol: string): Promise<FinnhubTechnicals> {
    const key = `FH_TECH:${symbol}`;
    const cached = await this.getCached(key);
    if (cached) return cached as FinnhubTechnicals;

    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=3mo`;
    const res = await fetch(yahooUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) throw new Error(`Yahoo Finance candles failed for ${symbol}: ${res.statusText}`);
    const raw = await res.json();

    const result0 = raw?.chart?.result?.[0];
    const quote = result0?.indicators?.quote?.[0];
    const data = quote
      ? { c: quote.close, h: quote.high, l: quote.low }
      : null;

    // insufficient or missing history → neutral fallback
    if (!data || !data.c || data.c.filter(Boolean).length < 20) {
      return {
        technicalAnalysis: { count: { buy: 0, neutral: 7, sell: 0 }, signal: "neutral" },
        trend: { adx: 20, trending: false },
      };
    }

    const result = computeTechnicals(data);
    await this.setCached(key, result, STOCKS_CONSTANTS.CACHE_TTL_MINUTES.TECHNICALS);
    return result;
  }

  static async fetchProfile(symbol: string): Promise<FinnhubProfile> {
    const key = `FH_PROF:${symbol}`;
    const cached = await this.getCached(key);
    if (cached) return cached as FinnhubProfile;

    const url = `${FINNHUB_BASE}/stock/profile2?symbol=${symbol}&token=${env.FINNHUB_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Finnhub profile failed for ${symbol}: ${res.statusText}`);
    }
    const data = await res.json();
    await this.setCached(key, data, STOCKS_CONSTANTS.CACHE_TTL_MINUTES.PROFILE);
    return data as FinnhubProfile;
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

interface CandleData { c: number[]; h: number[]; l: number[] }

function computeTechnicals(candles: CandleData): FinnhubTechnicals {
  const closes = candles.c;
  const n = closes.length;
  const price = closes[n - 1];
  const signals: ("buy" | "neutral" | "sell")[] = [];

  // 1. RSI(14)
  const rsi = computeRSI(closes, 14);
  signals.push(rsi < 30 ? "buy" : rsi > 70 ? "sell" : "neutral");

  // 2. Price vs SMA(20)
  const sma20 = computeSMA(closes, 20);
  signals.push(price > sma20 ? "buy" : "sell");

  // 3 & 4. SMA(50) crossover
  if (n >= 50) {
    const sma50 = computeSMA(closes, 50);
    signals.push(price > sma50 ? "buy" : "sell");     // price vs SMA50
    signals.push(sma20 > sma50 ? "buy" : "sell");     // golden/death cross
  } else {
    signals.push("neutral");
    signals.push("neutral");
  }

  // 5. MACD(12,26,9)
  const { macdLine, signalLine } = computeMACD(closes);
  signals.push(macdLine > signalLine ? "buy" : macdLine < signalLine ? "sell" : "neutral");

  // 6. Bollinger Bands(20,2)
  const { upper, lower } = computeBollinger(closes, 20, 2);
  signals.push(price < lower ? "buy" : price > upper ? "sell" : "neutral");

  // 7. SMA(20) slope (compare to 5 periods ago)
  const sma20Prev = computeSMA(closes.slice(0, n - 5), 20);
  signals.push(sma20 > sma20Prev ? "buy" : "sell");

  const count = { buy: 0, neutral: 0, sell: 0 };
  for (const s of signals) count[s]++;
  const signal: "buy" | "sell" | "neutral" =
    count.buy > count.sell ? "buy" : count.sell > count.buy ? "sell" : "neutral";

  // ATR(14) as trend strength proxy (~0–100)
  const atr = computeATR(candles.h, candles.l, closes, 14);
  const adx = Math.min(100, Math.round((atr / price) * 100 * 12));

  return { technicalAnalysis: { count, signal }, trend: { adx, trending: adx > 25 } };
}

function computeSMA(closes: number[], period: number): number {
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function computeRSI(closes: number[], period: number): number {
  const changes = closes.slice(1).map((c, i) => c - closes[i]);
  let avgGain = changes.slice(0, period).filter(c => c > 0).reduce((a, b) => a + b, 0) / period;
  let avgLoss = changes.slice(0, period).filter(c => c < 0).map(c => -c).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? -changes[i] : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function computeEMA(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema = [values[0]];
  for (let i = 1; i < values.length; i++) {
    ema.push(values[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

function computeMACD(closes: number[]): { macdLine: number; signalLine: number } {
  const ema12 = computeEMA(closes, 12);
  const ema26 = computeEMA(closes, 26);
  const macdSeries = ema12.map((v, i) => v - ema26[i]);
  const signalSeries = computeEMA(macdSeries, 9);
  const last = macdSeries.length - 1;
  return { macdLine: macdSeries[last], signalLine: signalSeries[last] };
}

function computeBollinger(closes: number[], period: number, mult: number) {
  const sma = computeSMA(closes, period);
  const slice = closes.slice(-period);
  const variance = slice.reduce((acc, v) => acc + Math.pow(v - sma, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  return { upper: sma + mult * stdDev, lower: sma - mult * stdDev };
}

function computeATR(highs: number[], lows: number[], closes: number[], period: number): number {
  const trs: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    trs.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    ));
  }
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}
