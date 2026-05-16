import { Request, Response } from "express";
import { SignalService } from "../services/signal.service";
import { asyncHandler } from "../middleware/asyncHandler";
import { AppError } from "../middleware/errorHandler";
import { env } from "../config/env";

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
    const pageRaw = Number.parseInt(String(req.query.page ?? ""), 10);
    const limitRaw = Number.parseInt(String(req.query.limit ?? ""), 10);
    const page =
      Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : undefined;
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;

    const result = await SignalService.getSignalHistory(page, limit);
    res.status(200).json(result);
  },
);

export const getApprovedSignalsWinRate = asyncHandler(
  async (_req: Request, res: Response) => {
    const stats = await SignalService.getApprovedSignalsWinRate();
    res.status(200).json({ success: true, ...stats });
  },
);

export const invalidateApprovedCache = asyncHandler(
  async (req: Request, res: Response) => {
    const expected = env.SIGNALS_INVALIDATE_SECRET;
    if (!expected) {
      throw new AppError(503, "Cache invalidation not configured");
    }
    if (req.header("x-invalidate-secret") !== expected) {
      throw new AppError(401, "Invalid invalidation secret");
    }
    await SignalService.invalidateApprovedCache();
    res.status(204).send();
  },
);
