import mongoose, { Document, Schema } from "mongoose";

// A drawing-tool template (saved settings for a specific drawing tool).
// Persisted per user via the Charting Library's IExternalSaveLoadAdapter
// drawing-template methods. Unique per (userId, toolName, name).
export interface IDrawingTemplate extends Document {
  userId: mongoose.Types.ObjectId;
  toolName: string;
  name: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

const DrawingTemplateSchema = new Schema<IDrawingTemplate>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    toolName: { type: String, required: true },
    name: { type: String, required: true },
    content: { type: String, required: true },
  },
  { timestamps: true },
);

DrawingTemplateSchema.index(
  { userId: 1, toolName: 1, name: 1 },
  { unique: true },
);

export default mongoose.model<IDrawingTemplate>(
  "DrawingTemplate",
  DrawingTemplateSchema,
);
