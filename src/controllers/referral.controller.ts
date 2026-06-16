import { Request, Response } from "express";
import User from "../models/user.model";
import { asyncHandler } from "../middleware/asyncHandler";
import { AppError } from "../middleware/errorHandler";
import { ReferralService } from "../services/referral.service";

function ensureAuthenticatedUser(req: Request): string {
  if (!req.user) {
    throw new AppError(401, "Unauthorized");
  }
  return req.user.userId;
}

export const getReferralOverview = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError(404, "User not found");
    }

    const overview = await ReferralService.getOverview(user);
    res.status(200).json(overview);
  },
);

export const getReferralTransactions = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    const transactions = await ReferralService.getTransactions(userId);
    res.status(200).json({ transactions });
  },
);

export const getReferralLeaderboard = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError(404, "User not found");
    }

    const leaderboard = await ReferralService.getLeaderboard(user);
    res.status(200).json(leaderboard);
  },
);
