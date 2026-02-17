import { Request, Response } from "express";
import { SignalService } from "../services/signal.service";
import { asyncHandler } from "../middleware/asyncHandler";
import { AppError } from "../middleware/errorHandler";

export const getApprovedSignals = asyncHandler(
  async (_req: Request, res: Response) => {
    const data = await SignalService.getApprovedSignals();
    console.log("data", data);
    res.status(200).json(data);
  },
);

export const playSignal = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.userId;
  const { signalId, symbol, signalType, entryPrice, targetPrice, stopLoss } =
    req.body;

  if (!signalId || !symbol || !signalType || !entryPrice) {
    throw new AppError(
      400,
      "Missing required fields: signalId, symbol, signalType, entryPrice",
    );
  }

  const signalPlay = await SignalService.playSignal({
    userId,
    signalId,
    symbol,
    signalType,
    entryPrice,
    targetPrice,
    stopLoss,
  });

  res.status(201).json({
    message: "Signal played successfully",
    data: signalPlay,
  });
});

export const getSignalHistory = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    const page = parseInt(req.query.page as string);
    const limit = parseInt(req.query.limit as string);

    const result = await SignalService.getSignalHistory(userId, page, limit);
    res.status(200).json(result);
  },
);
