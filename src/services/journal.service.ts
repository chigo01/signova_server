import mongoose from "mongoose";
import Journal, {
  IJournal,
  JournalProperty,
  JournalRow,
  JournalView,
} from "../models/journal.model";
import SignalPlay from "../models/signalPlay.model";
import { AppError } from "../middleware/errorHandler";

export interface JournalUpdateData {
  title?: string;
  properties?: JournalProperty[];
  views?: JournalView[];
  rows?: JournalRow[];
}

const DEFAULT_PROPERTIES: JournalProperty[] = [
  { id: "pair", name: "Pair", type: "text", width: 330 },
  { id: "date", name: "Date", type: "date", width: 330 },
  {
    id: "bias",
    name: "Bias",
    type: "select",
    width: 330,
    options: [
      { id: "daily-bullish", label: "Daily bullish", color: "emerald" },
      { id: "daily-bearish", label: "Daily bearish", color: "rose" },
      { id: "neutral", label: "Neutral", color: "zinc" },
    ],
  },
  {
    id: "tags",
    name: "Tags",
    type: "multi-select",
    width: 220,
    options: [
      { id: "eq", label: "EQ", color: "cyan" },
      { id: "ob", label: "OB", color: "rose" },
      { id: "fvg", label: "FVG", color: "amber" },
    ],
    hidden: true,
  },
];

const DEFAULT_VIEWS: JournalView[] = [
  { id: "table", name: "Table", type: "table" },
];

function normalizeObjectId(id: string, label: string): mongoose.Types.ObjectId {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError(400, `${label} is invalid`);
  }

  return new mongoose.Types.ObjectId(id);
}

function normalizeTitle(title: unknown): string {
  if (typeof title !== "string") return "";
  return title.trim().slice(0, 120);
}

function rowFromSignalPlay(signalPlay: {
  _id: unknown;
  signalId: string;
  symbol: string;
  signalType: "buy" | "sell";
  entryPrice: number;
  targetPrice?: number;
  stopLoss?: number;
  playedAt: Date;
}): JournalRow {
  const now = new Date();
  const signalPlayId = String(signalPlay._id);

  return {
    id: `signal-${signalPlayId}`,
    linkedSignalPlayId: new mongoose.Types.ObjectId(signalPlayId),
    sourceSignalId: signalPlay.signalId,
    cells: {
      pair: signalPlay.symbol,
      date: signalPlay.playedAt.toISOString(),
      bias:
        signalPlay.signalType === "buy" ? "Daily bullish" : "Daily bearish",
      tags: [],
      entryPrice: signalPlay.entryPrice,
      targetPrice: signalPlay.targetPrice,
      stopLoss: signalPlay.stopLoss,
    },
    createdAt: now,
    updatedAt: now,
  };
}

export class JournalService {
  static async getOrCreateDefaultJournal(userId: string): Promise<IJournal> {
    const userObjectId = normalizeObjectId(userId, "userId");
    const existing = await Journal.findOne({
      userId: userObjectId,
      isDefault: true,
    });

    if (existing) return existing;

    return await Journal.create({
      userId: userObjectId,
      title: "",
      isDefault: true,
      properties: DEFAULT_PROPERTIES,
      views: DEFAULT_VIEWS,
      rows: [],
    });
  }

  static async updateJournal(
    userId: string,
    journalId: string,
    data: JournalUpdateData,
  ): Promise<IJournal> {
    const userObjectId = normalizeObjectId(userId, "userId");
    const journalObjectId = normalizeObjectId(journalId, "journalId");
    const journal = await Journal.findOne({
      _id: journalObjectId,
      userId: userObjectId,
    });

    if (!journal) {
      throw new AppError(404, "Journal not found");
    }

    if ("title" in data) {
      journal.title = normalizeTitle(data.title);
    }

    if (Array.isArray(data.properties)) {
      journal.properties = data.properties;
    }

    if (Array.isArray(data.views)) {
      journal.views = data.views;
    }

    if (Array.isArray(data.rows)) {
      journal.rows = data.rows.map((row) => ({
        ...row,
        updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date(),
        createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
      }));
    }

    await journal.save();
    return journal;
  }

  static async addRow(
    userId: string,
    journalId: string,
    cells: Record<string, unknown>,
  ): Promise<IJournal> {
    const journal = await this.getUserJournal(userId, journalId);
    const now = new Date();

    journal.rows.push({
      id: `row-${now.getTime()}`,
      cells: cells ?? {},
      createdAt: now,
      updatedAt: now,
    });

    await journal.save();
    return journal;
  }

  static async updateRow(
    userId: string,
    journalId: string,
    rowId: string,
    cells: Record<string, unknown>,
  ): Promise<IJournal> {
    const journal = await this.getUserJournal(userId, journalId);
    const row = journal.rows.find((item) => item.id === rowId);

    if (!row) {
      throw new AppError(404, "Journal row not found");
    }

    row.cells = { ...row.cells, ...cells };
    row.updatedAt = new Date();

    await journal.save();
    return journal;
  }

  static async importSignalPlays(
    userId: string,
    journalId: string,
  ): Promise<{ journal: IJournal; importedCount: number }> {
    const journal = await this.getUserJournal(userId, journalId);
    const userObjectId = normalizeObjectId(userId, "userId");
    const linkedIds = new Set(
      journal.rows
        .map((row) => row.linkedSignalPlayId)
        .filter(Boolean)
        .map((id) => String(id)),
    );

    const signalPlays = await SignalPlay.find({ userId: userObjectId })
      .sort({ playedAt: -1 })
      .limit(100);

    const newRows = signalPlays
      .filter((signalPlay) => !linkedIds.has(String(signalPlay._id)))
      .map(rowFromSignalPlay);

    if (newRows.length > 0) {
      journal.rows.unshift(...newRows);
      await journal.save();
    }

    return { journal, importedCount: newRows.length };
  }

  private static async getUserJournal(
    userId: string,
    journalId: string,
  ): Promise<IJournal> {
    const userObjectId = normalizeObjectId(userId, "userId");
    const journalObjectId = normalizeObjectId(journalId, "journalId");
    const journal = await Journal.findOne({
      _id: journalObjectId,
      userId: userObjectId,
    });

    if (!journal) {
      throw new AppError(404, "Journal not found");
    }

    return journal;
  }
}
