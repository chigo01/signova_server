import mongoose from "mongoose";
import ChartLayout from "../models/chartLayout.model";
import StudyTemplate from "../models/studyTemplate.model";
import DrawingTemplate from "../models/drawingTemplate.model";
import ChartTemplate from "../models/chartTemplate.model";
import { AppError } from "../middleware/errorHandler";

function toObjectId(id: string, label: string): mongoose.Types.ObjectId {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new AppError(400, `${label} is invalid`);
  }

  return new mongoose.Types.ObjectId(id);
}

export interface ChartLayoutInput {
  id?: string;
  name: string;
  symbol: string;
  resolution: string;
  content: string;
}

export interface ChartLayoutMeta {
  id: string;
  name: string;
  symbol: string;
  resolution: string;
  timestamp: number;
}

function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export class ChartPresetService {
  // ----- Chart layouts (saveChart / getAllCharts / ...) -----

  static async listChartLayouts(userId: string): Promise<ChartLayoutMeta[]> {
    const docs = await ChartLayout.find({ userId: toObjectId(userId, "userId") })
      .sort({ updatedAt: -1 })
      .lean();

    return docs.map((doc) => ({
      id: String(doc._id),
      name: doc.name,
      symbol: doc.symbol,
      resolution: doc.resolution,
      timestamp: toUnixSeconds(doc.updatedAt),
    }));
  }

  static async saveChartLayout(
    userId: string,
    input: ChartLayoutInput,
  ): Promise<string> {
    const owner = toObjectId(userId, "userId");
    if (!input.name) throw new AppError(400, "name is required");
    if (typeof input.content !== "string") {
      throw new AppError(400, "content is required");
    }

    const fields = {
      name: input.name,
      symbol: input.symbol ?? "",
      resolution: input.resolution ?? "",
      content: input.content,
    };

    if (input.id) {
      const updated = await ChartLayout.findOneAndUpdate(
        { _id: toObjectId(input.id, "id"), userId: owner },
        { $set: fields },
        { new: true },
      );
      if (!updated) throw new AppError(404, "Chart layout not found");
      return String(updated._id);
    }

    const created = await ChartLayout.create({ userId: owner, ...fields });
    return String(created._id);
  }

  static async getChartLayoutContent(
    userId: string,
    id: string,
  ): Promise<string> {
    const doc = await ChartLayout.findOne({
      _id: toObjectId(id, "id"),
      userId: toObjectId(userId, "userId"),
    }).lean();

    if (!doc) throw new AppError(404, "Chart layout not found");
    return doc.content;
  }

  static async removeChartLayout(userId: string, id: string): Promise<void> {
    await ChartLayout.deleteOne({
      _id: toObjectId(id, "id"),
      userId: toObjectId(userId, "userId"),
    });
  }

  // ----- Study templates -----

  static async listStudyTemplates(userId: string): Promise<{ name: string }[]> {
    const docs = await StudyTemplate.find({
      userId: toObjectId(userId, "userId"),
    })
      .sort({ name: 1 })
      .lean();

    return docs.map((doc) => ({ name: doc.name }));
  }

  static async saveStudyTemplate(
    userId: string,
    name: string,
    content: string,
  ): Promise<void> {
    if (!name) throw new AppError(400, "name is required");
    if (typeof content !== "string") {
      throw new AppError(400, "content is required");
    }

    await StudyTemplate.findOneAndUpdate(
      { userId: toObjectId(userId, "userId"), name },
      { $set: { content } },
      { upsert: true, new: true },
    );
  }

  static async getStudyTemplateContent(
    userId: string,
    name: string,
  ): Promise<string> {
    const doc = await StudyTemplate.findOne({
      userId: toObjectId(userId, "userId"),
      name,
    }).lean();

    if (!doc) throw new AppError(404, "Study template not found");
    return doc.content;
  }

  static async removeStudyTemplate(
    userId: string,
    name: string,
  ): Promise<void> {
    await StudyTemplate.deleteOne({
      userId: toObjectId(userId, "userId"),
      name,
    });
  }

  // ----- Drawing templates -----

  static async listDrawingTemplates(
    userId: string,
    toolName: string,
  ): Promise<string[]> {
    const docs = await DrawingTemplate.find({
      userId: toObjectId(userId, "userId"),
      toolName,
    })
      .sort({ name: 1 })
      .lean();

    return docs.map((doc) => doc.name);
  }

  static async saveDrawingTemplate(
    userId: string,
    toolName: string,
    name: string,
    content: string,
  ): Promise<void> {
    if (!toolName) throw new AppError(400, "toolName is required");
    if (!name) throw new AppError(400, "name is required");
    if (typeof content !== "string") {
      throw new AppError(400, "content is required");
    }

    await DrawingTemplate.findOneAndUpdate(
      { userId: toObjectId(userId, "userId"), toolName, name },
      { $set: { content } },
      { upsert: true, new: true },
    );
  }

  static async getDrawingTemplate(
    userId: string,
    toolName: string,
    name: string,
  ): Promise<string> {
    const doc = await DrawingTemplate.findOne({
      userId: toObjectId(userId, "userId"),
      toolName,
      name,
    }).lean();

    if (!doc) throw new AppError(404, "Drawing template not found");
    return doc.content;
  }

  static async removeDrawingTemplate(
    userId: string,
    toolName: string,
    name: string,
  ): Promise<void> {
    await DrawingTemplate.deleteOne({
      userId: toObjectId(userId, "userId"),
      toolName,
      name,
    });
  }

  // ----- Chart templates (styling) -----

  static async listChartTemplates(userId: string): Promise<string[]> {
    const docs = await ChartTemplate.find({
      userId: toObjectId(userId, "userId"),
    })
      .sort({ name: 1 })
      .lean();

    return docs.map((doc) => doc.name);
  }

  static async saveChartTemplate(
    userId: string,
    name: string,
    content: unknown,
  ): Promise<void> {
    if (!name) throw new AppError(400, "name is required");
    if (content === undefined || content === null) {
      throw new AppError(400, "content is required");
    }

    await ChartTemplate.findOneAndUpdate(
      { userId: toObjectId(userId, "userId"), name },
      { $set: { content } },
      { upsert: true, new: true },
    );
  }

  static async getChartTemplateContent(
    userId: string,
    name: string,
  ): Promise<unknown> {
    const doc = await ChartTemplate.findOne({
      userId: toObjectId(userId, "userId"),
      name,
    }).lean();

    if (!doc) throw new AppError(404, "Chart template not found");
    return doc.content;
  }

  static async removeChartTemplate(
    userId: string,
    name: string,
  ): Promise<void> {
    await ChartTemplate.deleteOne({
      userId: toObjectId(userId, "userId"),
      name,
    });
  }
}
