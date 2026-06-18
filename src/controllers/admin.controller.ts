import { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { AppError } from "../middleware/errorHandler";
import { AdminService } from "../services/admin.service";

function adminEmail(req: Request): string {
  if (!req.user?.email) throw new AppError(401, "Unauthorized");
  return req.user.email;
}

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const search = typeof req.query.search === "string" ? req.query.search : undefined;
  const page = req.query.page ? Number(req.query.page) : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const result = await AdminService.listUsers({ search, page, limit });
  res.status(200).json(result);
});

export const getUser = asyncHandler(async (req: Request, res: Response) => {
  const detail = await AdminService.getUser(req.params.id);
  res.status(200).json(detail);
});

export const setUserRate = asyncHandler(async (req: Request, res: Response) => {
  const affiliate = await AdminService.setRate(req.params.id, req.body?.rateUsd);
  res.status(200).json({ affiliate });
});

export const recordPayout = asyncHandler(async (req: Request, res: Response) => {
  const result = await AdminService.recordPayout(
    req.params.id,
    req.body ?? {},
    adminEmail(req),
  );
  res.status(201).json(result);
});

export const getPayouts = asyncHandler(async (req: Request, res: Response) => {
  const payouts = await AdminService.getPayouts(req.params.id);
  res.status(200).json({ payouts });
});

export const getLeaderboard = asyncHandler(async (_req: Request, res: Response) => {
  const entries = await AdminService.getLeaderboard();
  res.status(200).json({ entries });
});

export const getStats = asyncHandler(async (_req: Request, res: Response) => {
  const stats = await AdminService.getStats();
  res.status(200).json(stats);
});
