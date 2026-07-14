import { Document, Schema, model } from "mongoose";

export type StockNewsMaterialStatus =
  | "pending"
  | "material"
  | "not_material"
  | "failed";

export interface IStockNewsArticle extends Document {
  fingerprint: string;
  providerId?: string;
  symbols: string[];
  headline: string;
  source: string;
  url: string;
  sourceSummary: string;
  publishedAt: Date;
  materialStatus: StockNewsMaterialStatus;
  category?: string;
  emailSummary?: string;
  whyItMatters?: string;
  classificationAttempts: number;
  createdAt: Date;
  updatedAt: Date;
}

const StockNewsArticleSchema = new Schema<IStockNewsArticle>(
  {
    fingerprint: { type: String, required: true, unique: true },
    providerId: { type: String },
    symbols: { type: [String], required: true, index: true },
    headline: { type: String, required: true },
    source: { type: String, required: true },
    url: { type: String, required: true },
    sourceSummary: { type: String, default: "" },
    publishedAt: { type: Date, required: true, index: true },
    materialStatus: {
      type: String,
      enum: ["pending", "material", "not_material", "failed"],
      default: "pending",
      index: true,
    },
    category: { type: String },
    emailSummary: { type: String },
    whyItMatters: { type: String },
    classificationAttempts: { type: Number, default: 0 },
  },
  { timestamps: true },
);

StockNewsArticleSchema.index({ symbols: 1, publishedAt: -1 });

export default model<IStockNewsArticle>(
  "StockNewsArticle",
  StockNewsArticleSchema,
);
