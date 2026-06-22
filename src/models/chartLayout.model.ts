import mongoose, { Document, Schema } from "mongoose";

// A full saved TradingView chart layout (symbol + interval + drawings +
// indicators + styling). Persisted per user via the Charting Library's
// IExternalSaveLoadAdapter (saveChart / getAllCharts / getChartContent /
// removeChart).
export interface IChartLayout extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  symbol: string;
  resolution: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

const ChartLayoutSchema = new Schema<IChartLayout>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    symbol: { type: String, default: "" },
    resolution: { type: String, default: "" },
    content: { type: String, required: true },
  },
  { timestamps: true },
);

ChartLayoutSchema.index({ userId: 1, updatedAt: -1 });

export default mongoose.model<IChartLayout>("ChartLayout", ChartLayoutSchema);
