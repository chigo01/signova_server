import { FCSAPI_CONSTANTS } from "../config/constants";
import { FcsapiService } from "./fcsapi.service";
import { SignalService } from "./signal.service";

const SUPPORTED_RESOLUTIONS = [
  "1",
  "5",
  "15",
  "30",
  "60",
  "240",
  "1D",
  "1W",
] as const;

const SUPPORTED_INTRADAY_MULTIPLIERS = ["1", "5", "15", "30", "60", "240"];

const FX_EXCHANGE = {
  value: "FX",
  name: "FX",
  desc: "Forex",
};

const FX_SYMBOL_TYPE = {
  name: "Forex",
  value: "forex",
};

const CURRENCY_NAMES: Record<string, string> = {
  AUD: "Australian Dollar",
  CAD: "Canadian Dollar",
  CHF: "Swiss Franc",
  EUR: "Euro",
  GBP: "British Pound",
  JPY: "Japanese Yen",
  NZD: "New Zealand Dollar",
  USD: "US Dollar",
};

type SupportedResolution = (typeof SUPPORTED_RESOLUTIONS)[number];
type TrendDirection = "bullish" | "bearish" | "sideways";
type BiasDirection = "buy" | "sell" | "neutral";

interface FcsapiHistoryCandle {
  o: string | number;
  h: string | number;
  l: string | number;
  c: string | number;
  tm: string | number;
  v?: string | number | null;
}

interface FcsapiHistoryPayload {
  response?: FcsapiHistoryCandle[];
}

interface NormalizedCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ApprovedSignalLike {
  pair: string;
  direction: "BUY" | "SELL" | "HOLD";
  timeframe?: string;
  confidence?: number;
  entryPrice: number;
  exitTargets?: {
    takeProfit1?: number;
    stopLoss?: number;
  };
  reasoning?: string[];
}

interface AnalysisOverlay {
  id: string;
  label: string;
  price: number;
  color: string;
  lineStyle: "solid" | "dashed";
  emphasis: "primary" | "secondary";
}

function normalizeSymbol(raw: string): string {
  const withoutPrefix = raw.split(":").pop() ?? raw;
  return withoutPrefix.replace(/[^A-Za-z]/g, "").toUpperCase();
}

function isSupportedPair(symbol: string): boolean {
  return (FCSAPI_CONSTANTS.CORE_PAIRS as readonly string[]).includes(symbol);
}

function isJpyPair(symbol: string): boolean {
  return symbol.endsWith("JPY");
}

function getPriceDecimals(symbol: string): number {
  return isJpyPair(symbol) ? 3 : 5;
}

function roundPrice(symbol: string, value: number): number {
  const factor = 10 ** getPriceDecimals(symbol);
  return Math.round(value * factor) / factor;
}

function pairDescription(symbol: string): string {
  if (symbol.length !== 6) return symbol;
  const base = symbol.slice(0, 3);
  const quote = symbol.slice(3);
  return `${CURRENCY_NAMES[base] ?? base} / ${CURRENCY_NAMES[quote] ?? quote}`;
}

function toFiniteNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeResolution(resolution: string): SupportedResolution {
  const normalized = resolution.toUpperCase();
  const aliases: Record<string, SupportedResolution> = {
    "1": "1",
    "5": "5",
    "15": "15",
    "30": "30",
    "60": "60",
    "240": "240",
    D: "1D",
    "1D": "1D",
    W: "1W",
    "1W": "1W",
  };

  return aliases[normalized] ?? "60";
}

function resolutionToPeriod(resolution: string): string {
  const normalized = normalizeResolution(resolution);
  const periodMap: Record<SupportedResolution, string> = {
    "1": "1m",
    "5": "5m",
    "15": "15m",
    "30": "30m",
    "60": "1h",
    "240": "4h",
    "1D": "1d",
    "1W": "1w",
  };

  return periodMap[normalized];
}

function resolutionToSeconds(resolution: string): number {
  const normalized = normalizeResolution(resolution);
  const secondMap: Record<SupportedResolution, number> = {
    "1": 60,
    "5": 300,
    "15": 900,
    "30": 1800,
    "60": 3600,
    "240": 14400,
    "1D": 86400,
    "1W": 604800,
  };

  return secondMap[normalized];
}

function sliceRecent<T>(values: T[], count: number): T[] {
  if (values.length <= count) return values;
  return values.slice(values.length - count);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeSma(values: number[], period: number): number {
  return average(sliceRecent(values, period));
}

function computeAtr(candles: NormalizedCandle[], period: number): number {
  if (candles.length < 2) return 0;
  const window = sliceRecent(candles, period + 1);
  const ranges: number[] = [];

  for (let index = 1; index < window.length; index += 1) {
    const current = window[index];
    const previous = window[index - 1];
    const highLow = current.high - current.low;
    const highClose = Math.abs(current.high - previous.close);
    const lowClose = Math.abs(current.low - previous.close);
    ranges.push(Math.max(highLow, highClose, lowClose));
  }

  return average(ranges);
}

function uniqueLevels(symbol: string, levels: number[]): number[] {
  const seen = new Set<number>();
  const result: number[] = [];

  for (const level of levels) {
    const rounded = roundPrice(symbol, level);
    if (seen.has(rounded)) continue;
    seen.add(rounded);
    result.push(rounded);
  }

  return result;
}

function extractCandles(payload: unknown): NormalizedCandle[] {
  const response = (payload as FcsapiHistoryPayload | null)?.response;
  if (!Array.isArray(response)) return [];

  return response
    .map((item) => {
      const time = toFiniteNumber(item.tm);
      const open = toFiniteNumber(item.o);
      const high = toFiniteNumber(item.h);
      const low = toFiniteNumber(item.l);
      const close = toFiniteNumber(item.c);
      const volume = toFiniteNumber(item.v) ?? 0;

      if (
        time == null ||
        open == null ||
        high == null ||
        low == null ||
        close == null
      ) {
        return null;
      }

      return {
        time: time > 9999999999 ? Math.floor(time / 1000) : Math.floor(time),
        open,
        high,
        low,
        close,
        volume,
      };
    })
    .filter((item): item is NormalizedCandle => item !== null)
    .sort((left, right) => left.time - right.time);
}

function extractApprovedSignals(payload: unknown): ApprovedSignalLike[] {
  const extracted: ApprovedSignalLike[] = [];

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const signals = (item as { signals?: unknown }).signals;
      if (Array.isArray(signals)) {
        extracted.push(...(signals as ApprovedSignalLike[]));
      }
    }
    return extracted;
  }

  const signals = (payload as { signals?: unknown } | null)?.signals;
  return Array.isArray(signals) ? (signals as ApprovedSignalLike[]) : [];
}

async function getApprovedSignalForSymbol(
  symbol: string
): Promise<ApprovedSignalLike | null> {
  try {
    const approvedSignals = await SignalService.getApprovedSignals();
    const signals = extractApprovedSignals(approvedSignals);

    return (
      signals.find((signal) => normalizeSymbol(signal.pair) === symbol) ?? null
    );
  } catch (error) {
    console.warn("Failed to hydrate approved signal context:", error);
    return null;
  }
}

export class ForexChartService {
  static getConfig() {
    return {
      supports_search: true,
      supports_group_request: false,
      supports_marks: false,
      supports_timescale_marks: false,
      supports_time: true,
      exchanges: [FX_EXCHANGE],
      symbols_types: [FX_SYMBOL_TYPE],
      supported_resolutions: [...SUPPORTED_RESOLUTIONS],
    };
  }

  static searchSymbols(
    query: string,
    symbolType: string,
    exchange: string,
    limit: number
  ) {
    if (symbolType && symbolType !== "forex") {
      return [];
    }

    if (exchange && exchange !== FX_EXCHANGE.value) {
      return [];
    }

    const normalizedQuery = normalizeSymbol(query);

    return FCSAPI_CONSTANTS.CORE_PAIRS.filter((pair) => {
      if (!normalizedQuery) return true;

      return (
        pair.includes(normalizedQuery) ||
        pairDescription(pair).toUpperCase().includes(normalizedQuery)
      );
    })
      .slice(0, Math.max(1, Math.min(limit, 30)))
      .map((pair) => ({
        symbol: pair,
        full_name: `${FX_EXCHANGE.value}:${pair}`,
        description: pairDescription(pair),
        exchange: FX_EXCHANGE.value,
        ticker: pair,
        type: FX_SYMBOL_TYPE.value,
      }));
  }

  static resolveSymbol(symbol: string) {
    const normalized = normalizeSymbol(symbol);

    if (!isSupportedPair(normalized)) {
      return null;
    }

    const pricescale = isJpyPair(normalized) ? 1000 : 100000;

    return {
      name: normalized,
      ticker: normalized,
      description: pairDescription(normalized),
      type: FX_SYMBOL_TYPE.value,
      session: "24x7",
      timezone: "Etc/UTC",
      exchange: FX_EXCHANGE.value,
      listed_exchange: FX_EXCHANGE.value,
      minmov: 1,
      pricescale,
      has_intraday: true,
      has_daily: true,
      has_weekly_and_monthly: true,
      supported_resolutions: [...SUPPORTED_RESOLUTIONS],
      intraday_multipliers: [...SUPPORTED_INTRADAY_MULTIPLIERS],
      volume_precision: 0,
      data_status: "streaming",
      format: "price",
      "session-regular": "24x7",
      "supported-resolutions": [...SUPPORTED_RESOLUTIONS],
      "exchange-listed": FX_EXCHANGE.value,
      "exchange-traded": FX_EXCHANGE.value,
      "has-intraday": true,
      "has-daily": true,
      "has-weekly-and-monthly": true,
      "intraday-multipliers": [...SUPPORTED_INTRADAY_MULTIPLIERS],
    };
  }

  static async getHistory(
    symbol: string,
    resolution: string,
    params: {
      from?: number;
      to?: number;
      countBack?: number;
    }
  ) {
    const normalized = normalizeSymbol(symbol);
    if (!isSupportedPair(normalized)) {
      return { s: "error", errmsg: "unknown_symbol" };
    }

    const normalizedResolution = normalizeResolution(resolution);
    const to =
      params.to != null && Number.isFinite(params.to)
        ? params.to
        : Math.floor(Date.now() / 1000);
    const countBack =
      params.countBack != null && Number.isFinite(params.countBack)
        ? params.countBack
        : undefined;
    const inferredFrom =
      countBack != null
        ? Math.max(0, to - countBack * resolutionToSeconds(normalizedResolution))
        : undefined;
    const from =
      params.from != null && Number.isFinite(params.from)
        ? params.from
        : inferredFrom;

    const history = await FcsapiService.getHistoricalCandles(
      normalized,
      resolutionToPeriod(normalizedResolution),
      {
        from,
        to,
        limit: countBack,
      }
    );

    const candles = extractCandles(history.signals).filter((candle) => {
      if (from != null && candle.time < from) return false;
      if (candle.time > to) return false;
      return true;
    });

    const finalCandles =
      countBack != null && candles.length > countBack
        ? candles.slice(candles.length - countBack)
        : candles;

    if (finalCandles.length === 0) {
      return {
        s: "no_data",
        nextTime: null,
      };
    }

    return {
      s: "ok",
      t: finalCandles.map((candle) => candle.time),
      o: finalCandles.map((candle) => candle.open),
      h: finalCandles.map((candle) => candle.high),
      l: finalCandles.map((candle) => candle.low),
      c: finalCandles.map((candle) => candle.close),
      v: finalCandles.map((candle) => candle.volume),
    };
  }

  static async getQuotes(symbols: string[]) {
    const results = await Promise.all(
      symbols.map(async (symbol) => {
        const normalized = normalizeSymbol(symbol);
        if (!isSupportedPair(normalized)) {
          return null;
        }

        const history = await FcsapiService.getHistoricalCandles(
          normalized,
          "1h",
          { limit: 2 }
        );
        const candles = extractCandles(history.signals);
        const latest = candles[candles.length - 1];
        const previous = candles[candles.length - 2] ?? latest;

        if (!latest || !previous) {
          return null;
        }

        const change = latest.close - previous.close;
        const changePercent =
          previous.close !== 0 ? (change / previous.close) * 100 : 0;

        return {
          short_name: normalized,
          exchange: FX_EXCHANGE.value,
          description: pairDescription(normalized),
          lp: latest.close,
          ask: latest.close,
          bid: latest.close,
          spread: 0,
          open_price: latest.open,
          high_price: latest.high,
          low_price: latest.low,
          prev_close_price: previous.close,
          ch: change,
          chp: changePercent,
          volume: latest.volume,
        };
      })
    );

    return {
      s: "ok",
      d: results.filter((item): item is NonNullable<typeof item> => item !== null),
    };
  }

  static async getAnalysis(
    symbol: string,
    resolution: string,
    preset: string,
    range: {
      from?: number;
      to?: number;
    }
  ) {
    const normalized = normalizeSymbol(symbol);
    if (!isSupportedPair(normalized)) {
      return null;
    }

    const normalizedResolution = normalizeResolution(resolution);
    const history = await FcsapiService.getHistoricalCandles(
      normalized,
      resolutionToPeriod(normalizedResolution),
      {
        from: range.from,
        to: range.to,
        limit: range.from != null || range.to != null ? undefined : 250,
      }
    );

    const candles = extractCandles(history.signals);
    if (candles.length === 0) {
      return {
        success: true,
        symbol: normalized,
        interval: normalizedResolution,
        preset,
        summary: null,
        supportResistance: {
          support: [],
          resistance: [],
        },
        overlays: [],
        signal: null,
        notes: ["No historical candles were returned for this symbol yet."],
      };
    }

    const latest = candles[candles.length - 1];
    const previous = candles[candles.length - 2] ?? latest;
    const closes = candles.map((candle) => candle.close);
    const sma20 = computeSma(closes, 20);
    const sma50 = computeSma(closes, 50);
    const atr14 = computeAtr(candles, 14);
    const recentWindow = sliceRecent(candles, 20);
    const swingWindow = sliceRecent(candles, 50);
    const support = uniqueLevels(normalized, [
      Math.min(...recentWindow.map((candle) => candle.low)),
      Math.min(...swingWindow.map((candle) => candle.low)),
    ]).sort((left, right) => right - left);
    const resistance = uniqueLevels(normalized, [
      Math.max(...recentWindow.map((candle) => candle.high)),
      Math.max(...swingWindow.map((candle) => candle.high)),
    ]).sort((left, right) => left - right);

    const trend: TrendDirection =
      latest.close > sma20 && sma20 >= sma50
        ? "bullish"
        : latest.close < sma20 && sma20 <= sma50
          ? "bearish"
          : "sideways";

    const approvedSignal = await getApprovedSignalForSymbol(normalized);
    const bias: BiasDirection =
      approvedSignal?.direction === "BUY"
        ? "buy"
        : approvedSignal?.direction === "SELL"
          ? "sell"
          : trend === "bullish"
            ? "buy"
            : trend === "bearish"
              ? "sell"
              : "neutral";

    const overlays: AnalysisOverlay[] = [
      ...support.map((price, index) => ({
        id: `support-${index + 1}`,
        label: `Support ${index + 1}`,
        price,
        color: "#22c55e",
        lineStyle: "dashed" as const,
        emphasis: "secondary" as const,
      })),
      ...resistance.map((price, index) => ({
        id: `resistance-${index + 1}`,
        label: `Resistance ${index + 1}`,
        price,
        color: "#f97316",
        lineStyle: "dashed" as const,
        emphasis: "secondary" as const,
      })),
    ];

    if (approvedSignal && preset !== "market-structure-only") {
      overlays.push(
        {
          id: "entry",
          label: "Entry",
          price: roundPrice(normalized, approvedSignal.entryPrice),
          color: "#e5e7eb",
          lineStyle: "solid",
          emphasis: "primary",
        },
        {
          id: "take-profit",
          label: "Take Profit",
          price: roundPrice(
            normalized,
            approvedSignal.exitTargets?.takeProfit1 ?? approvedSignal.entryPrice
          ),
          color: "#10b981",
          lineStyle: "solid",
          emphasis: "primary",
        },
        {
          id: "stop-loss",
          label: "Stop Loss",
          price: roundPrice(
            normalized,
            approvedSignal.exitTargets?.stopLoss ?? approvedSignal.entryPrice
          ),
          color: "#ef4444",
          lineStyle: "solid",
          emphasis: "primary",
        }
      );
    }

    const notes = [
      `Trend is ${trend} with price ${
        latest.close >= sma20 ? "above" : "below"
      } the 20-period average.`,
      `Nearest support is ${support[0] != null ? roundPrice(normalized, support[0]) : "n/a"} and nearest resistance is ${
        resistance[0] != null ? roundPrice(normalized, resistance[0]) : "n/a"
      }.`,
    ];

    if (approvedSignal) {
      notes.push(
        `Approved ${approvedSignal.direction.toLowerCase()} setup is available on ${
          approvedSignal.timeframe ?? normalizedResolution
        } with ${approvedSignal.confidence ?? 0}% confidence.`
      );
    } else {
      notes.push("No approved signal is attached to this pair right now.");
    }

    return {
      success: true,
      symbol: normalized,
      interval: normalizedResolution,
      preset,
      summary: {
        lastPrice: roundPrice(normalized, latest.close),
        change: roundPrice(normalized, latest.close - previous.close),
        changePercent:
          previous.close !== 0
            ? Number(
                (((latest.close - previous.close) / previous.close) * 100).toFixed(2)
              )
            : 0,
        trend,
        bias,
        atr14: roundPrice(normalized, atr14),
        sma20: roundPrice(normalized, sma20),
        sma50: roundPrice(normalized, sma50),
        recentHigh: roundPrice(
          normalized,
          Math.max(...recentWindow.map((candle) => candle.high))
        ),
        recentLow: roundPrice(
          normalized,
          Math.min(...recentWindow.map((candle) => candle.low))
        ),
        candles: candles.length,
        updatedAt: new Date(latest.time * 1000).toISOString(),
      },
      supportResistance: {
        support,
        resistance,
      },
      overlays,
      signal: approvedSignal
        ? {
            pair: approvedSignal.pair,
            direction: approvedSignal.direction,
            confidence: approvedSignal.confidence ?? 0,
            timeframe: approvedSignal.timeframe ?? normalizedResolution,
            entryPrice: roundPrice(normalized, approvedSignal.entryPrice),
            takeProfit1: roundPrice(
              normalized,
              approvedSignal.exitTargets?.takeProfit1 ?? approvedSignal.entryPrice
            ),
            stopLoss: roundPrice(
              normalized,
              approvedSignal.exitTargets?.stopLoss ?? approvedSignal.entryPrice
            ),
            reasoning: approvedSignal.reasoning ?? [],
          }
        : null,
      notes,
    };
  }
}
