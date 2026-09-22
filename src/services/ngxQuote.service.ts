import StocksCache from "../models/stocksCache.model";
import { STOCKS_CONSTANTS } from "../config/constants";
import { NGX_BOARD, isNgxSymbol } from "../config/ngxBoard";

/** Column order sent to the Nigeria scanner. `change` is already a percent. */
export const NGX_SCAN_COLUMNS = [
  "name",
  "description",
  "close",
  "change",
  "change_abs",
  "high",
  "low",
  "market_cap_basic",
  "sector",
] as const;

const SCAN_URL = "https://scanner.tradingview.com/nigeria/scan";
const CACHE_KEY = "NGX_BOARD";

export interface NgxListing {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  sector: string;
  /** Absolute naira, not millions. */
  marketCap: number;
  technicalSignal: "neutral";
  technicalCount: { buy: number; neutral: number; sell: number };
  adx: number;
  trending: boolean;
  recommendation: "HOLD";
  confidence: number;
  reasons: string[];
  market: "NGX";
  currency: "NGN";
}

export interface NgxQuote {
  price: number;
  change: number;
  changePercent: number;
  currency: "NGN";
}

export interface NgxScannerPayload {
  data?: Array<{ s?: string; d?: unknown[] }>;
}

function num(value: unknown): number {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  return Number.isFinite(n) ? n : 0;
}

function shell(item: { symbol: string; name: string }): NgxListing {
  return {
    symbol: item.symbol,
    name: item.name,
    price: 0,
    change: 0,
    changePercent: 0,
    high: 0,
    low: 0,
    sector: "Nigerian Exchange",
    marketCap: 0,
    technicalSignal: "neutral",
    technicalCount: { buy: 0, neutral: 0, sell: 0 },
    adx: 0,
    trending: false,
    recommendation: "HOLD",
    confidence: 0,
    reasons: [],
    market: "NGX",
    currency: "NGN",
  };
}

export function fallbackNgxBoard(): NgxListing[] {
  return NGX_BOARD.map(shell);
}

/**
 * Map one scanner response onto the curated board. Unknown tickers are
 * dropped. Names missing from the response keep the catalog name and a zero
 * price so the row can still open a chart.
 */
export function quotesFromScannerRows(payload: NgxScannerPayload): NgxListing[] {
  const index = new Map(NGX_SCAN_COLUMNS.map((key, i) => [key, i]));
  const bySymbol = new Map<string, NgxListing>();

  for (const row of payload.data ?? []) {
    const symbol = String(row.s ?? "")
      .split(":")
      .pop()
      ?.trim()
      .toUpperCase() ?? "";
    if (!isNgxSymbol(symbol)) continue;
    const d = row.d ?? [];
    const at = (key: (typeof NGX_SCAN_COLUMNS)[number]) => d[index.get(key)!];
    const descriptionValue = at("description");
    const sectorValue = at("sector");
    const description =
      typeof descriptionValue === "string" ? descriptionValue.trim() : "";
    const sector = typeof sectorValue === "string" ? sectorValue.trim() : "";
    const catalog = NGX_BOARD.find((item) => item.symbol === symbol);
    bySymbol.set(symbol, {
      ...shell({ symbol, name: description || catalog?.name || symbol }),
      price: num(at("close")),
      change: num(at("change_abs")),
      changePercent: num(at("change")),
      high: num(at("high")),
      low: num(at("low")),
      sector: sector || "Nigerian Exchange",
      marketCap: num(at("market_cap_basic")),
    });
  }

  return NGX_BOARD.map((item) => bySymbol.get(item.symbol) ?? shell(item));
}

function isListingArray(value: unknown): value is NgxListing[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof (item as NgxListing).symbol === "string" &&
        typeof (item as NgxListing).price === "number",
    )
  );
}

export class NgxQuoteService {
  private static inflight: Promise<NgxListing[]> | null = null;

  static getBoard(): Promise<NgxListing[]> {
    if (!this.inflight) {
      this.inflight = this.loadBoard().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  static async getQuote(symbol: string): Promise<NgxQuote | null> {
    const board = await this.getBoard();
    const row = board.find((item) => item.symbol === symbol);
    if (!row || row.price <= 0) return null;
    return {
      price: row.price,
      change: row.change,
      changePercent: row.changePercent,
      currency: "NGN",
    };
  }

  private static async loadBoard(): Promise<NgxListing[]> {
    const cached = await this.readCache();
    if (cached) return cached;

    try {
      const fresh = await this.fetchBoard();
      if (fresh.some((item) => item.price > 0)) {
        try {
          await this.writeCache(fresh);
        } catch (err) {
          console.warn("NGX cache write failed:", err);
        }
      }
      return fresh;
    } catch (err) {
      console.warn("NGX board unavailable:", err);
      return fallbackNgxBoard();
    }
  }

  private static async fetchBoard(): Promise<NgxListing[]> {
    const res = await fetch(SCAN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
      },
      body: JSON.stringify({
        symbols: {
          tickers: NGX_BOARD.map((item) => `NSENG:${item.symbol}`),
          query: { types: [] },
        },
        columns: NGX_SCAN_COLUMNS,
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      throw new Error(`NGX scan failed: ${res.status}`);
    }
    const body = (await res.json()) as NgxScannerPayload;
    const listed = quotesFromScannerRows(body);
    if (!listed.some((item) => item.price > 0)) {
      throw new Error("NGX scan returned no prices");
    }
    return listed;
  }

  private static async readCache(): Promise<NgxListing[] | null> {
    try {
      const doc = await StocksCache.findOne({
        cacheKey: CACHE_KEY,
        expiresAt: { $gt: new Date() },
      });
      const listings = (doc?.data as { listings?: unknown } | undefined)?.listings;
      if (!isListingArray(listings) || !listings.some((item) => item.price > 0)) {
        return null;
      }
      return listings;
    } catch (err) {
      console.warn("NGX cache read failed:", err);
      return null;
    }
  }

  private static async writeCache(listings: NgxListing[]): Promise<void> {
    const expiresAt = new Date(
      Date.now() + STOCKS_CONSTANTS.CACHE_TTL_MINUTES.QUOTE * 60 * 1000,
    );
    await StocksCache.findOneAndUpdate(
      { cacheKey: CACHE_KEY },
      { data: { listings }, fetchedAt: new Date(), expiresAt },
      { upsert: true },
    );
  }
}
