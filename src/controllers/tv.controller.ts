import { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { AppError } from "../middleware/errorHandler";
import { ForexChartService } from "../services/forex-chart.service";

export const getTvConfig = asyncHandler(async (_req: Request, res: Response) => {
  res.status(200).json(ForexChartService.getConfig());
});

export const searchTvSymbols = asyncHandler(
  async (req: Request, res: Response) => {
    const query = String(req.query.query ?? "");
    const symbolType = String(req.query.type ?? "");
    const exchange = String(req.query.exchange ?? "");
    const limitRaw = Number.parseInt(String(req.query.limit ?? "30"), 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 30;

    res
      .status(200)
      .json(ForexChartService.searchSymbols(query, symbolType, exchange, limit));
  }
);

export const resolveTvSymbol = asyncHandler(
  async (req: Request, res: Response) => {
    const symbol = String(req.query.symbol ?? "");
    if (!symbol) {
      throw new AppError(400, "Symbol query parameter is required");
    }

    const result = ForexChartService.resolveSymbol(symbol);
    if (!result) {
      throw new AppError(404, "unknown_symbol");
    }

    res.status(200).json(result);
  }
);

export const getTvHistory = asyncHandler(
  async (req: Request, res: Response) => {
    const symbol = String(req.query.symbol ?? "");
    if (!symbol) {
      throw new AppError(400, "Symbol query parameter is required");
    }

    const resolution = String(req.query.resolution ?? "60");
    const fromRaw = Number.parseInt(String(req.query.from ?? ""), 10);
    const toRaw = Number.parseInt(String(req.query.to ?? ""), 10);
    const countBackRaw = Number.parseInt(String(req.query.countback ?? ""), 10);

    const result = await ForexChartService.getHistory(symbol, resolution, {
      from: Number.isFinite(fromRaw) ? fromRaw : undefined,
      to: Number.isFinite(toRaw) ? toRaw : undefined,
      countBack: Number.isFinite(countBackRaw) ? countBackRaw : undefined,
    });

    res.status(200).json(result);
  }
);

export const getTvTime = asyncHandler(async (_req: Request, res: Response) => {
  res.status(200).json(Math.floor(Date.now() / 1000));
});

export const getTvQuotes = asyncHandler(async (req: Request, res: Response) => {
  const rawSymbols = String(req.query.symbols ?? "");
  const symbols = rawSymbols
    .split(",")
    .map((symbol) => symbol.trim())
    .filter(Boolean);

  if (symbols.length === 0) {
    throw new AppError(400, "At least one symbol is required");
  }

  const result = await ForexChartService.getQuotes(symbols);
  res.status(200).json(result);
});
