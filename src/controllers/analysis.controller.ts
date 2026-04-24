import { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { AppError } from "../middleware/errorHandler";
import { ForexChartService } from "../services/forex-chart.service";

export const getPairAnalysis = asyncHandler(
  async (req: Request, res: Response) => {
    const symbol = String(req.params.symbol ?? "");
    if (!symbol) {
      throw new AppError(400, "Symbol route parameter is required");
    }

    const resolution = String(req.query.resolution ?? "60");
    const preset = String(req.query.preset ?? "approved-signal");
    const fromRaw = Number.parseInt(String(req.query.from ?? ""), 10);
    const toRaw = Number.parseInt(String(req.query.to ?? ""), 10);

    const result = await ForexChartService.getAnalysis(symbol, resolution, preset, {
      from: Number.isFinite(fromRaw) ? fromRaw : undefined,
      to: Number.isFinite(toRaw) ? toRaw : undefined,
    });

    if (!result) {
      throw new AppError(404, "Unknown forex symbol");
    }

    res.status(200).json(result);
  }
);
