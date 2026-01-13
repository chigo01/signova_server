import { Request, Response } from "express";
import SignalPlay from "../models/signalPlay.model";

const ADMIN_SERVER_URL =
  process.env.ADMIN_SERVER_URL || "http://localhost:8000";

export const getApprovedSignals = async (_req: Request, res: Response) => {
  try {
    const response = await fetch(`${ADMIN_SERVER_URL}/approved-signals`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Admin server error:", errorText);
      res.status(response.status).json({
        message: "Failed to fetch signals from admin server",
        error: errorText,
      });
      return;
    }

    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    console.error("Error fetching top 5 refined signals:", error);
    res.status(500).json({
      message: "Internal server error",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

export const playSignal = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?._id;
    const { signalId, symbol, signalType, entryPrice, targetPrice, stopLoss } =
      req.body;

    if (!signalId || !symbol || !signalType || !entryPrice) {
      res.status(400).json({
        message:
          "Missing required fields: signalId, symbol, signalType, entryPrice",
      });
      return;
    }

    const signalPlay = new SignalPlay({
      userId,
      signalId,
      symbol,
      signalType,
      entryPrice,
      targetPrice,
      stopLoss,
      playedAt: new Date(),
    });

    await signalPlay.save();

    res.status(201).json({
      message: "Signal played successfully",
      data: signalPlay,
    });
  } catch (error) {
    console.error("Error saving signal play:", error);
    res.status(500).json({
      message: "Internal server error",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

export const getSignalHistory = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?._id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const [history, total] = await Promise.all([
      SignalPlay.find({ userId })
        .sort({ playedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      SignalPlay.countDocuments({ userId }),
    ]);

    res.status(200).json({
      data: history,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching signal history:", error);
    res.status(500).json({
      message: "Internal server error",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
