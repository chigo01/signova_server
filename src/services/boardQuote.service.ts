import StocksCache from "../models/stocksCache.model";
import { STOCKS_CONSTANTS } from "../config/constants";
import { NGX_BOARD } from "../config/ngxBoard";
import { KRX_BOARD } from "../config/krxBoard";

/** Column order sent to the exchange scanner. `change` is already a percent. */
export const BOARD_SCAN_COLUMNS = [
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

export type ListedMarket = "NGX" | "KRX";
export type ListedCurrency = "NGN" | "KRW";

export interface BoardSpec {
  id: ListedMarket;
  currency: ListedCurrency;
  tvPrefix: string;
  scanMarket: string;
  cacheKey: string;
  sectorFallback: string;
  listings: ReadonlyArray<{ symbol: string; name: string }>;
}

export const NGX_SPEC: BoardSpec = {
  id: "NGX",
  currency: "NGN",
  tvPrefix: "NSENG",
  scanMarket: "nigeria",
  cacheKey: "NGX_BOARD",
  sectorFallback: "Nigerian Exchange",
  listings: NGX_BOARD,
};

export const KRX_SPEC: BoardSpec = {
  id: "KRX",
  currency: "KRW",
  tvPrefix: "KRX",
  scanMarket: "korea",
  cacheKey: "KRX_BOARD",
  sectorFallback: "Korea Exchange",
  listings: KRX_BOARD,
};

const SPECS: Record<ListedMarket, BoardSpec> = {
  NGX: NGX_SPEC,
  KRX: KRX_SPEC,
};

export interface BoardListing {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  sector: string;
  /** Absolute local currency, not millions. */
  marketCap: number;
  technicalSignal: "neutral";
  technicalCount: { buy: number; neutral: number; sell: number };
  adx: number;
  trending: boolean;
  recommendation: "HOLD";
  confidence: number;
  reasons: string[];
  market: ListedMarket;
  currency: ListedCurrency;
}

export interface BoardQuote {
  price: number;
  change: number;
  changePercent: number;
  currency: ListedCurrency;
}

export interface BoardScannerPayload {
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

function shell(
  spec: BoardSpec,
  item: { symbol: string; name: string },
): BoardListing {
  return {
    symbol: item.symbol,
    name: item.name,
    price: 0,
    change: 0,
    changePercent: 0,
    high: 0,
    low: 0,
    sector: spec.sectorFallback,
    marketCap: 0,
    technicalSignal: "neutral",
    technicalCount: { buy: 0, neutral: 0, sell: 0 },
    adx: 0,
    trending: false,
    recommendation: "HOLD",
    confidence: 0,
    reasons: [],
    market: spec.id,
    currency: spec.currency,
  };
}

export function fallbackBoard(spec: BoardSpec): BoardListing[] {
  return spec.listings.map((item) => shell(spec, item));
}

/**
 * Map one scanner response onto a curated board. Unknown tickers are dropped.
 * Names missing from the response keep the catalog name and a zero price so
 * the row can still open a chart.
 */
export function quotesFromBoardRows(
  spec: BoardSpec,
  payload: BoardScannerPayload,
): BoardListing[] {
  const known = new Set(spec.listings.map((item) => item.symbol));
  const index = new Map(BOARD_SCAN_COLUMNS.map((key, i) => [key, i]));
  const bySymbol = new Map<string, BoardListing>();

  for (const row of payload.data ?? []) {
    const symbol = String(row.s ?? "")
      .split(":")
      .pop()
      ?.trim()
      .toUpperCase() ?? "";
    if (!known.has(symbol)) continue;
    const d = row.d ?? [];
    const at = (key: (typeof BOARD_SCAN_COLUMNS)[number]) => d[index.get(key)!];
    const descriptionValue = at("description");
    const sectorValue = at("sector");
    const description =
      typeof descriptionValue === "string" ? descriptionValue.trim() : "";
    const sector = typeof sectorValue === "string" ? sectorValue.trim() : "";
    const catalog = spec.listings.find((item) => item.symbol === symbol);
    bySymbol.set(symbol, {
      ...shell(spec, { symbol, name: description || catalog?.name || symbol }),
      price: num(at("close")),
      change: num(at("change_abs")),
      changePercent: num(at("change")),
      high: num(at("high")),
      low: num(at("low")),
      sector: sector || spec.sectorFallback,
      marketCap: num(at("market_cap_basic")),
    });
  }

  return spec.listings.map((item) => bySymbol.get(item.symbol) ?? shell(spec, item));
}

function isListingArray(value: unknown): value is BoardListing[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof (item as BoardListing).symbol === "string" &&
        typeof (item as BoardListing).price === "number",
    )
  );
}

export class BoardQuoteService {
  private static inflight = new Map<ListedMarket, Promise<BoardListing[]>>();

  static getBoard(market: ListedMarket): Promise<BoardListing[]> {
    const pending = this.inflight.get(market);
    if (pending) return pending;
    const next = this.loadBoard(SPECS[market]).finally(() => {
      this.inflight.delete(market);
    });
    this.inflight.set(market, next);
    return next;
  }

  static async getQuote(
    market: ListedMarket,
    symbol: string,
  ): Promise<BoardQuote | null> {
    const board = await this.getBoard(market);
    const row = board.find((item) => item.symbol === symbol);
    if (!row || row.price <= 0) return null;
    return {
      price: row.price,
      change: row.change,
      changePercent: row.changePercent,
      currency: row.currency,
    };
  }

  private static async loadBoard(spec: BoardSpec): Promise<BoardListing[]> {
    const cached = await this.readCache(spec);
    if (cached) return cached;

    try {
      const fresh = await this.fetchBoard(spec);
      if (fresh.some((item) => item.price > 0)) {
        try {
          await this.writeCache(spec, fresh);
        } catch (err) {
          console.warn(`${spec.id} cache write failed:`, err);
        }
      }
      return fresh;
    } catch (err) {
      console.warn(`${spec.id} board unavailable:`, err);
      return fallbackBoard(spec);
    }
  }

  private static async fetchBoard(spec: BoardSpec): Promise<BoardListing[]> {
    const res = await fetch(
      `https://scanner.tradingview.com/${spec.scanMarket}/scan`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0",
        },
        body: JSON.stringify({
          symbols: {
            tickers: spec.listings.map((item) => `${spec.tvPrefix}:${item.symbol}`),
            query: { types: [] },
          },
          columns: BOARD_SCAN_COLUMNS,
        }),
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (!res.ok) {
      throw new Error(`${spec.id} scan failed: ${res.status}`);
    }
    const body = (await res.json()) as BoardScannerPayload;
    const listed = quotesFromBoardRows(spec, body);
    if (!listed.some((item) => item.price > 0)) {
      throw new Error(`${spec.id} scan returned no prices`);
    }
    return listed;
  }

  private static async readCache(spec: BoardSpec): Promise<BoardListing[] | null> {
    try {
      const doc = await StocksCache.findOne({
        cacheKey: spec.cacheKey,
        expiresAt: { $gt: new Date() },
      });
      const listings = (doc?.data as { listings?: unknown } | undefined)?.listings;
      if (!isListingArray(listings) || !listings.some((item) => item.price > 0)) {
        return null;
      }
      return listings;
    } catch (err) {
      console.warn(`${spec.id} cache read failed:`, err);
      return null;
    }
  }

  private static async writeCache(
    spec: BoardSpec,
    listings: BoardListing[],
  ): Promise<void> {
    const expiresAt = new Date(
      Date.now() + STOCKS_CONSTANTS.CACHE_TTL_MINUTES.QUOTE * 60 * 1000,
    );
    await StocksCache.findOneAndUpdate(
      { cacheKey: spec.cacheKey },
      { data: { listings }, fetchedAt: new Date(), expiresAt },
      { upsert: true },
    );
  }
}
