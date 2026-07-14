import mongoose, { Document, Schema, model } from "mongoose";

export type StockNewsDeliveryStatus = "pending" | "sent" | "failed";

export interface IStockNewsDelivery extends Document {
  deliveryKey: string;
  userId: mongoose.Types.ObjectId;
  mode: "immediate" | "daily";
  articleIds: mongoose.Types.ObjectId[];
  localDate?: string;
  status: StockNewsDeliveryStatus;
  attempts: number;
  lastError?: string;
  sentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const StockNewsDeliverySchema = new Schema<IStockNewsDelivery>(
  {
    deliveryKey: { type: String, required: true, unique: true },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    mode: { type: String, enum: ["immediate", "daily"], required: true },
    articleIds: [{ type: Schema.Types.ObjectId, ref: "StockNewsArticle" }],
    localDate: { type: String },
    status: {
      type: String,
      enum: ["pending", "sent", "failed"],
      default: "pending",
      index: true,
    },
    attempts: { type: Number, default: 0 },
    lastError: { type: String },
    sentAt: { type: Date },
  },
  { timestamps: true },
);

StockNewsDeliverySchema.index({ userId: 1, status: 1, createdAt: -1 });

export default model<IStockNewsDelivery>(
  "StockNewsDelivery",
  StockNewsDeliverySchema,
);
