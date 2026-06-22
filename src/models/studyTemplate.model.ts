import mongoose, { Document, Schema } from "mongoose";

// A study (indicator) template: the set of indicators a trader applies plus
// their settings. Persisted per user via the Charting Library's
// IExternalSaveLoadAdapter study-template methods. Unique per (userId, name)
// so re-saving the same name overwrites.
export interface IStudyTemplate extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  content: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const StudyTemplateSchema = new Schema<IStudyTemplate>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    content: { type: String, required: true },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true },
);

StudyTemplateSchema.index({ userId: 1, name: 1 }, { unique: true });

// At most one default study template per user (mirrors the Journal default
// pattern). Auto-applied to every chart when a new signal loads.
StudyTemplateSchema.index(
  { userId: 1 },
  { unique: true, partialFilterExpression: { isDefault: true } },
);

export default mongoose.model<IStudyTemplate>(
  "StudyTemplate",
  StudyTemplateSchema,
);
