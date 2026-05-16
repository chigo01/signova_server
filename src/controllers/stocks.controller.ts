import { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { StocksService } from "../services/stocks.service";

export const getRecommendations = asyncHandler(
  async (_req: Request, res: Response) => {
    const data = await StocksService.getRecommendations();
    res.status(200).json(data);
  }
);

export const getTopNews = asyncHandler(
  async (_req: Request, res: Response) => {
    const data = await StocksService.getTopNews();
    res.status(200).json(data);
  }
);
