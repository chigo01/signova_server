import { Document, Schema, model } from "mongoose";

interface IStockNewsRun extends Document {
  bucket: string;
  status: "running" | "completed" | "failed";
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}

const StockNewsRunSchema = new Schema<IStockNewsRun>(
  {
    bucket: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ["running", "completed", "failed"],
      default: "running",
    },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date },
    error: { type: String },
  },
  { timestamps: true },
);

StockNewsRunSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 30 },
);

export default model<IStockNewsRun>("StockNewsRun", StockNewsRunSchema);
