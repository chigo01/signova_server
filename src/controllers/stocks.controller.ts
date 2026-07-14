import { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { StocksService } from "../services/stocks.service";
import { AppError } from "../middleware/errorHandler";
import {
  WatchlistLimitError,
  WatchlistService,
} from "../services/watchlist.service";

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

function authenticatedUserId(req: Request): string {
  if (!req.user?.userId) throw new AppError(401, "Unauthorized");
  return req.user.userId;
}

function rethrowWatchlistError(error: unknown): never {
  if (error instanceof WatchlistLimitError) throw error;
  const message = error instanceof Error ? error.message : "Watchlist request failed";
  if (
    message === "Invalid stock symbol" ||
    message === "symbol must be a string" ||
    message === "symbols must be an array" ||
    message === "Active stocks must already be in the watchlist" ||
    message === "Invalid stock news delivery mode" ||
    message === "Invalid IANA timezone"
  ) {
    throw new AppError(400, message);
  }
  if (message === "Stock symbol was not found") throw new AppError(404, message);
  throw error;
}

export const getPersonalWatchlist = asyncHandler(
  async (req: Request, res: Response) => {
    res.status(200).json(await WatchlistService.getWatchlist(authenticatedUserId(req)));
  },
);

export const addPersonalWatchlistStock = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const data = await WatchlistService.addStock(authenticatedUserId(req), {
        symbol: req.body?.symbol,
        delivery: req.body?.delivery,
        timezone: req.body?.timezone,
      });
      res.status(201).json(data);
    } catch (error) {
      if (error instanceof WatchlistLimitError) {
        res.status(409).json({
          success: false,
          code: error.code,
          message: error.message,
          limit: error.limit,
          currentCount: error.currentCount,
        });
        return;
      }
      rethrowWatchlistError(error);
    }
  },
);

export const removePersonalWatchlistStock = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      await WatchlistService.removeStock(authenticatedUserId(req), req.params.symbol);
      res.status(204).send();
    } catch (error) {
      rethrowWatchlistError(error);
    }
  },
);

export const setActivePersonalWatchlistStocks = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const data = await WatchlistService.setActiveStocks(
        authenticatedUserId(req),
        req.body?.symbols,
      );
      res.status(200).json(data);
    } catch (error) {
      if (error instanceof WatchlistLimitError) {
        res.status(409).json({
          success: false,
          code: error.code,
          message: error.message,
          limit: error.limit,
          currentCount: error.currentCount,
        });
        return;
      }
      rethrowWatchlistError(error);
    }
  },
);
