import { Request, Response } from "express";
import { FcsapiService } from "../services/fcsapi.service";
import { asyncHandler } from "../middleware/asyncHandler";
import { AppError } from "../middleware/errorHandler";
import { FCSAPI_CONSTANTS } from "../config/constants";

export const getPairSignal = asyncHandler(
  async (req: Request, res: Response) => {
    const { pair } = req.params;
    const period = (req.query.period as string) || FCSAPI_CONSTANTS.DEFAULT_PERIOD;
    const limit = parseInt(req.query.limit as string) || FCSAPI_CONSTANTS.DEFAULT_CANDLES;

    if (!pair) {
      throw new AppError(400, "Pair parameter is required");
    }

    // Validate pair
    if (!FcsapiService.isValidPair(pair)) {
      throw new AppError(
        400,
        `Invalid pair. Supported pairs: ${FCSAPI_CONSTANTS.CORE_PAIRS.join(", ")}`
      );
    }

    // Validate period
    const validPeriods = ["1m", "5m", "15m", "30m", "1h", "2h", "4h", "1d", "1w"];
    if (!validPeriods.includes(period)) {
      throw new AppError(
        400,
        `Invalid period. Supported periods: ${validPeriods.join(", ")}`
      );
    }

    // Validate limit (max 500 candles)
    if (limit < 1 || limit > 500) {
      throw new AppError(400, "Limit must be between 1 and 500");
    }

    const result = await FcsapiService.getPairSignal(pair, period, limit);
    res.status(200).json(result);
  }
);

export const getUsageStats = asyncHandler(
  async (_req: Request, res: Response) => {
    const result = await FcsapiService.getUsageStats();
    res.status(200).json(result);
  }
);
