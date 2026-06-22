import mongoose, { Document, Schema } from "mongoose";

// A chart template (visual styling: colors, scales, chart style). Persisted
// per user via the Charting Library's IExternalSaveLoadAdapter chart-template
// methods. The theme/content is a structured object, so stored as Mixed.
// Unique per (userId, name).
export interface IChartTemplate extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  content: unknown;
  createdAt: Date;
  updatedAt: Date;
}

const ChartTemplateSchema = new Schema<IChartTemplate>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    content: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true },
);

ChartTemplateSchema.index({ userId: 1, name: 1 }, { unique: true });

export default mongoose.model<IChartTemplate>(
  "ChartTemplate",
  ChartTemplateSchema,
);
