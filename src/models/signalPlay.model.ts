import mongoose, { Document, Schema } from "mongoose";

export interface ISignalPlay extends Document {
  userId: mongoose.Types.ObjectId;
  signalId: string;
  symbol: string;
  signalType: "buy" | "sell";
  entryPrice: number;
  targetPrice?: number;
  stopLoss?: number;
  playedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SignalPlaySchema: Schema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    signalId: { type: String, required: true },
    symbol: { type: String, required: true },
    signalType: { type: String, enum: ["buy", "sell"], required: true },
    entryPrice: { type: Number, required: true },
    targetPrice: { type: Number },
    stopLoss: { type: Number },
    playedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Index for efficient queries by user
SignalPlaySchema.index({ userId: 1, playedAt: -1 });

export default mongoose.model<ISignalPlay>("SignalPlay", SignalPlaySchema);
