import { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  createRaffleAdminSession,
  drawRaffleWinners,
  getRaffleSummary,
  registerForWebinar,
} from "../services/webinar.service";

export const registerWebinarAttendee = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await registerForWebinar(req.body);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(result);
  }
);

export const loginRaffleAdmin = asyncHandler(
  async (req: Request, res: Response) => {
    const session = createRaffleAdminSession(req.body?.password);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(session);
  }
);

export const getWebinarRaffle = asyncHandler(
  async (_req: Request, res: Response) => {
    const summary = await getRaffleSummary();
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(summary);
  }
);

export const runWebinarRaffle = asyncHandler(
  async (_req: Request, res: Response) => {
    const summary = await drawRaffleWinners();
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(summary);
  }
);
