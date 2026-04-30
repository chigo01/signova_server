import pLimit from "p-limit";
import OpenAI from "openai";
import { FinnhubService, FinnhubQuote, FinnhubTechnicals } from "./finnhub.service";
import { AlphaVantageService } from "./alphaVantage.service";
import StocksCache from "../models/stocksCache.model";
import { env } from "../config/env";
import { STOCKS_CONSTANTS } from "../config/constants";
import { PredictionService } from "./prediction.service";

export interface StockRecommendation {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  sector: string;
  marketCap: number;
  technicalSignal: "buy" | "sell" | "neutral";
  technicalCount: { buy: number; neutral: number; sell: number };
  adx: number;
  trending: boolean;
  recommendation: "BUY" | "HOLD" | "SELL";
  confidence: number;
  reasons: string[];
}

interface GPTRec {
  recommendation: "BUY" | "HOLD" | "SELL";
  confidence: number;
  reasons: string[];
}

const FALLBACK_REC: GPTRec = {
  recommendation: "HOLD",
  confidence: 50,
  reasons: ["Analysis temporarily unavailable"],
};

export class StocksService {
  private static openai: OpenAI | null = env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: env.OPENAI_API_KEY })
    : null;

  static async getRecommendations(): Promise<{
    watchlist: StockRecommendation[];
    topMovers: StockRecommendation[];
    lastUpdated: string;
  }> {
    // Step 1: Fetch top movers from Alpha Vantage (1 call/day, cached 24h)
    let moverSymbols: { symbol: string; isGainer: boolean }[] = [];

    if (env.ALPHAVANTAGE_API_KEY) {
      try {
        const topMovers = await AlphaVantageService.fetchTopMovers();
        const gainers = (topMovers.top_gainers || [])
          .slice(0, STOCKS_CONSTANTS.TOP_MOVERS_COUNT)
          .map((m) => ({ symbol: m.ticker, isGainer: true }));
        const losers = (topMovers.top_losers || [])
          .slice(0, STOCKS_CONSTANTS.TOP_MOVERS_COUNT)
          .map((m) => ({ symbol: m.ticker, isGainer: false }));
        moverSymbols = [...gainers, ...losers];
      } catch (err) {
        console.warn("Alpha Vantage top movers unavailable:", err);
      }
    }

    // Step 2: Build combined symbol set (watchlist + unique mover symbols)
    const watchlistSet = new Set<string>(STOCKS_CONSTANTS.WATCHLIST as unknown as string[]);
    const uniqueMoverSymbols = moverSymbols.filter((m) => !watchlistSet.has(m.symbol));

    const allSymbols: { symbol: string; isWatchlist: boolean }[] = [
      ...(STOCKS_CONSTANTS.WATCHLIST as unknown as string[]).map((s) => ({
        symbol: s,
        isWatchlist: true,
      })),
      ...uniqueMoverSymbols.map((m) => ({ symbol: m.symbol, isWatchlist: false })),
    ];

    // Step 3: Fetch Finnhub data for all symbols with concurrency limiting
    const limit = pLimit(STOCKS_CONSTANTS.FINNHUB_CONCURRENCY);

    const symbolData = await Promise.all(
      allSymbols.map(({ symbol, isWatchlist }) =>
        limit(async () => {
          try {
            const [quote, technicals, profile] = await Promise.all([
              FinnhubService.fetchQuote(symbol),
              FinnhubService.fetchTechnicals(symbol),
              isWatchlist
                ? FinnhubService.fetchProfile(symbol)
                : Promise.resolve({
                    name: symbol,
                    finnhubIndustry: "N/A",
                    marketCapitalization: 0,
                  }),
            ]);
            return { symbol, isWatchlist, quote, technicals, profile };
          } catch (err) {
            console.warn(`Finnhub data fetch failed for ${symbol}:`, err);
            return null;
          }
        })
      )
    );

    // Step 4: Get GPT recommendations for each symbol
    const validData = symbolData.filter(
      (d): d is NonNullable<typeof d> => d !== null
    );

    const recommendations = await Promise.all(
      validData.map(async ({ symbol, isWatchlist, quote, technicals, profile }) => {
        const gptRec = await this.getGptRecommendation(
          symbol,
          profile.name || symbol,
          profile.finnhubIndustry || "N/A",
          quote,
          technicals,
          profile.marketCapitalization || 0
        );

        const rec: StockRecommendation = {
          symbol,
          name: profile.name || symbol,
          price: quote.c || 0,
          change: quote.d || 0,
          changePercent: quote.dp || 0,
          high: quote.h || 0,
          low: quote.l || 0,
          sector: profile.finnhubIndustry || "N/A",
          marketCap: profile.marketCapitalization || 0,
          technicalSignal: technicals.technicalAnalysis?.signal || "neutral",
          technicalCount: technicals.technicalAnalysis?.count || {
            buy: 0,
            neutral: 0,
            sell: 0,
          },
          adx: technicals.trend?.adx || 0,
          trending: technicals.trend?.trending || false,
          recommendation: gptRec.recommendation,
          confidence: gptRec.confidence,
          reasons: gptRec.reasons,
        };

        return { rec, isWatchlist };
      })
    );

    // Step 5: Separate watchlist and topMovers, sort watchlist by confidence desc
    const moverSymbolSet = new Set(moverSymbols.map((m) => m.symbol));

    const watchlistRecs = recommendations
      .filter((r) => r.isWatchlist)
      .map((r) => r.rec)
      .sort((a, b) => b.confidence - a.confidence);

    const topMoverRecs = recommendations
      .filter((r) => !r.isWatchlist && moverSymbolSet.has(r.rec.symbol))
      .map((r) => r.rec);

    return {
      watchlist: watchlistRecs,
      topMovers: topMoverRecs,
      lastUpdated: new Date().toISOString(),
    };
  }

  private static async getGptRecommendation(
    symbol: string,
    name: string,
    sector: string,
    quote: FinnhubQuote,
    technicals: FinnhubTechnicals,
    marketCap: number
  ): Promise<GPTRec> {
    const cacheKey = `GPT_REC:${symbol}`;

    const cached = await StocksCache.findOne({
      cacheKey,
      expiresAt: { $gt: new Date() },
    });
    if (cached) return cached.data as GPTRec;

    if (!this.openai) return FALLBACK_REC;

    try {
      const count = technicals.technicalAnalysis?.count || {
        buy: 0,
        neutral: 0,
        sell: 0,
      };
      const signal = technicals.technicalAnalysis?.signal || "neutral";
      const adx = technicals.trend?.adx || 0;
      const trending = technicals.trend?.trending || false;

      const userPrompt = `Ticker: ${symbol} | Company: ${name} | Sector: ${sector}
Price: $${quote.c} (${quote.dp}% today) | Range: $${quote.l}–$${quote.h}
Technical aggregate (${trending ? "trending" : "ranging"} market, ADX ${adx}):
  ${count.buy} buy / ${count.neutral} neutral / ${count.sell} sell signals → overall: ${signal}
Market cap: $${marketCap}M`;

      const technicalSummary = `${symbol} analysis: ${trending ? "Trending" : "Ranging"}, ADX ${adx}, Signals: ${signal} (${count.buy}B/${count.neutral}N/${count.sell}S).`;
      const historicalContext = await PredictionService.getHistoricalContext(symbol, technicalSummary);

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4.1-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              'You are a professional stock analyst with access to your own historical analysis memory. Analyze the current data and consider the provided "Historical Analysis Memory" (if any) to ensure consistency or learn from past patterns. Return ONLY valid JSON with keys: recommendation ("BUY"|"HOLD"|"SELL"), confidence (integer 0–100), reasons (array of 2–3 concise specific strings). No markdown.',
          },
          { role: "user", content: userPrompt + historicalContext },
        ],
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) return FALLBACK_REC;

      const parsed = JSON.parse(content) as GPTRec;

      // Save the new prediction to historical memory (non-blocking)
      PredictionService.savePrediction({
        symbol,
        technicalState: technicalSummary,
        recommendation: parsed.recommendation,
        confidence: parsed.confidence,
        reasons: parsed.reasons,
      }).catch(err => console.error("Error saving prediction memory:", err));

      const expiresAt = new Date(
        Date.now() + STOCKS_CONSTANTS.CACHE_TTL_MINUTES.GPT_REC * 60 * 1000
      );
      await StocksCache.findOneAndUpdate(
        { cacheKey },
        { data: parsed, fetchedAt: new Date(), expiresAt },
        { upsert: true, returnDocument: "after" }
      );

      return parsed;
    } catch (err) {
      console.error(`GPT recommendation failed for ${symbol}:`, err);
      return FALLBACK_REC;
    }
  }
}
