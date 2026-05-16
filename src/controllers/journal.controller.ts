import { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { AppError } from "../middleware/errorHandler";
import { JournalService } from "../services/journal.service";

function ensureAuthenticatedUser(req: Request): string {
  if (!req.user) {
    throw new AppError(401, "Unauthorized");
  }

  return req.user.userId;
}

function ensureCells(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(400, "cells must be an object");
  }

  return value as Record<string, unknown>;
}

export const getDefaultJournal = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    const journal = await JournalService.getOrCreateDefaultJournal(userId);

    res.status(200).json({ success: true, journal });
  },
);

export const listJournals = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    const journals = await JournalService.listJournals(userId);

    res.status(200).json({ success: true, journals });
  },
);

export const createJournal = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    const journal = await JournalService.createJournal(userId);

    res.status(201).json({ success: true, journal });
  },
);

export const getJournal = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    const journal = await JournalService.getJournal(
      userId,
      req.params.journalId,
    );

    res.status(200).json({ success: true, journal });
  },
);

export const updateJournal = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    const journal = await JournalService.updateJournal(
      userId,
      req.params.journalId,
      req.body ?? {},
    );

    res.status(200).json({ success: true, journal });
  },
);

export const addJournalRow = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    const cells = ensureCells(req.body?.cells ?? {});
    const journal = await JournalService.addRow(
      userId,
      req.params.journalId,
      cells,
    );

    res.status(201).json({ success: true, journal });
  },
);

export const updateJournalRow = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    const cells = ensureCells(req.body?.cells);
    const journal = await JournalService.updateRow(
      userId,
      req.params.journalId,
      req.params.rowId,
      cells,
    );

    res.status(200).json({ success: true, journal });
  },
);

export const importSignalPlays = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    const { journal, importedCount } = await JournalService.importSignalPlays(
      userId,
      req.params.journalId,
    );

    res.status(200).json({ success: true, importedCount, journal });
  },
);
