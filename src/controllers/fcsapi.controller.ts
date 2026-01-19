import { Request, Response } from "express";
import { FcsapiService } from "../services/fcsapi.service";
import { asyncHandler } from "../middleware/asyncHandler";
import { AppError } from "../middleware/errorHandler";
import { FCSAPI_CONSTANTS } from "../config/constants";

export const getPairSignal = asyncHandler(
  async (req: Request, res: Response) => {
    const { pair } = req.params;

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

    const result = await FcsapiService.getPairSignal(pair);
    res.status(200).json(result);
  }
);

export const getUsageStats = asyncHandler(
  async (_req: Request, res: Response) => {
    const result = await FcsapiService.getUsageStats();
    res.status(200).json(result);
  }
);
