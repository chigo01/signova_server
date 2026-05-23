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
  { id: "pair", name: "Pair", type: "text", width: 260 },
  { id: "date", name: "Date", type: "date", width: 200 },
  {
    id: "bias",
    name: "Bias",
    type: "select",
    width: 200,
    options: [
      { id: "daily-bullish", label: "Daily bullish", color: "emerald" },
      { id: "daily-bearish", label: "Daily bearish", color: "rose" },
      { id: "neutral", label: "Neutral", color: "zinc" },
    ],
  },
  {
    id: "point-of-interest",
    name: "Point of interest",
    type: "multi-select",
    width: 240,
    options: [
      { id: "eq", label: "EQ", color: "cyan" },
      { id: "ob", label: "OB", color: "rose" },
      { id: "fvg", label: "FVG", color: "amber" },
    ],
  },
  {
    id: "outcome",
    name: "Outcome",
    type: "select",
    width: 200,
    options: [
      { id: "win", label: "Win", color: "emerald" },
      { id: "loss", label: "Loss", color: "rose" },
      { id: "break-even", label: "Break-even", color: "zinc" },
    ],
  },
];

const DEFAULT_VIEWS: JournalView[] = [
  { id: "table", name: "Table", type: "table" },
  { id: "calendar", name: "Calendar", type: "calendar" },
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
      "point-of-interest": [],
      outcome: "",
      entryPrice: signalPlay.entryPrice,
      targetPrice: signalPlay.targetPrice,
      stopLoss: signalPlay.stopLoss,
    },
    createdAt: now,
    updatedAt: now,
  };
}

export interface JournalSummary {
  _id: string;
  title: string;
  isDefault: boolean;
  updatedAt: Date;
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

  static async listJournals(userId: string): Promise<JournalSummary[]> {
    const userObjectId = normalizeObjectId(userId, "userId");
    const journals = await Journal.find(
      { userId: userObjectId },
      { title: 1, isDefault: 1, updatedAt: 1 },
    ).sort({ updatedAt: -1 });

    return journals.map((journal) => ({
      _id: String(journal._id),
      title: journal.title,
      isDefault: journal.isDefault,
      updatedAt: journal.updatedAt,
    }));
  }

  static async createJournal(userId: string): Promise<IJournal> {
    const userObjectId = normalizeObjectId(userId, "userId");
    return await Journal.create({
      userId: userObjectId,
      title: "",
      isDefault: false,
      properties: DEFAULT_PROPERTIES,
      views: DEFAULT_VIEWS,
      rows: [],
    });
  }

  static async getJournal(
    userId: string,
    journalId: string,
  ): Promise<IJournal> {
    return await this.getUserJournal(userId, journalId);
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

  static async deleteJournal(
    userId: string,
    journalId: string,
  ): Promise<void> {
    const userObjectId = normalizeObjectId(userId, "userId");
    const journalObjectId = normalizeObjectId(journalId, "journalId");

    // Don't allow deleting the user's only journal — keeps the empty-state
    // flow simpler on the client and matches the UI guard.
    const total = await Journal.countDocuments({ userId: userObjectId });
    if (total <= 1) {
      throw new AppError(
        400,
        "You can't delete your only journal. Create another first.",
      );
    }

    const journal = await Journal.findOne({
      _id: journalObjectId,
      userId: userObjectId,
    });
    if (!journal) {
      throw new AppError(404, "Journal not found");
    }

    // If the default journal is being deleted, promote the most recently
    // updated remaining journal to default so the user still has one
    // reachable via /journal/default.
    const wasDefault = journal.isDefault;
    await journal.deleteOne();

    if (wasDefault) {
      const successor = await Journal.findOne({ userId: userObjectId }).sort({
        updatedAt: -1,
      });
      if (successor) {
        successor.isDefault = true;
        await successor.save();
      }
    }
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
