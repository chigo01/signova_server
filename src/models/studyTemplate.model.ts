import mongoose, { Document, Schema } from "mongoose";

// A study (indicator) template: the set of indicators a trader applies plus
// their settings. Persisted per user via the Charting Library's
// IExternalSaveLoadAdapter study-template methods. Unique per (userId, name)
// so re-saving the same name overwrites.
export interface IStudyTemplate extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

const StudyTemplateSchema = new Schema<IStudyTemplate>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    content: { type: String, required: true },
  },
  { timestamps: true },
);

StudyTemplateSchema.index({ userId: 1, name: 1 }, { unique: true });

export default mongoose.model<IStudyTemplate>(
  "StudyTemplate",
  StudyTemplateSchema,
);
