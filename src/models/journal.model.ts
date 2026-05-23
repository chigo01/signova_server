import mongoose, { Document, Schema } from "mongoose";

export type JournalPropertyType =
  | "text"
  | "date"
  | "select"
  | "multi-select"
  | "number"
  | "ai";

export type JournalAiKind = "summary" | "key-info" | "custom" | "translation";

export interface JournalPropertyOption {
  id: string;
  label: string;
  color: string;
}

export interface JournalAiConfig {
  kind: JournalAiKind;
  // Custom autofill: free-form prompt. Summary/key-info: optional override.
  prompt?: string;
  // Translation only.
  targetLanguage?: string;
  // Which other property ids feed into the prompt context. Empty = all visible cells.
  sourcePropertyIds?: string[];
  // Cache the model id so re-generation stays consistent.
  model?: string;
}

export interface JournalProperty {
  id: string;
  name: string;
  type: JournalPropertyType;
  options?: JournalPropertyOption[];
  width?: number;
  hidden?: boolean;
  ai?: JournalAiConfig;
}

export interface JournalView {
  id: string;
  name: string;
  type: "table" | "calendar" | "board" | "gallery" | "list";
}

export interface JournalRow {
  id: string;
  cells: Record<string, unknown>;
  linkedSignalPlayId?: mongoose.Types.ObjectId;
  sourceSignalId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IJournal extends Document {
  userId: mongoose.Types.ObjectId;
  title: string;
  isDefault: boolean;
  properties: JournalProperty[];
  views: JournalView[];
  rows: JournalRow[];
  createdAt: Date;
  updatedAt: Date;
}

const JournalPropertyOptionSchema = new Schema<JournalPropertyOption>(
  {
    id: { type: String, required: true },
    label: { type: String, required: true },
    color: { type: String, required: true },
  },
  { _id: false },
);

const JournalAiConfigSchema = new Schema<JournalAiConfig>(
  {
    kind: {
      type: String,
      enum: ["summary", "key-info", "custom", "translation"],
      required: true,
    },
    prompt: { type: String },
    targetLanguage: { type: String },
    sourcePropertyIds: { type: [String], default: undefined },
    model: { type: String },
  },
  { _id: false },
);

const JournalPropertySchema = new Schema<JournalProperty>(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    type: {
      type: String,
      enum: ["text", "date", "select", "multi-select", "number", "ai"],
      required: true,
    },
    options: { type: [JournalPropertyOptionSchema], default: undefined },
    width: { type: Number },
    hidden: { type: Boolean, default: false },
    ai: { type: JournalAiConfigSchema, default: undefined },
  },
  { _id: false },
);

const JournalViewSchema = new Schema<JournalView>(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    type: {
      type: String,
      enum: ["table", "calendar", "board", "gallery", "list"],
      required: true,
    },
  },
  { _id: false },
);

const JournalRowSchema = new Schema<JournalRow>(
  {
    id: { type: String, required: true },
    cells: { type: Schema.Types.Mixed, required: true, default: {} },
    linkedSignalPlayId: { type: Schema.Types.ObjectId, ref: "SignalPlay" },
    sourceSignalId: { type: String },
    createdAt: { type: Date, required: true, default: Date.now },
    updatedAt: { type: Date, required: true, default: Date.now },
  },
  { _id: false },
);

const JournalSchema = new Schema<IJournal>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, default: "" },
    isDefault: { type: Boolean, default: true },
    properties: { type: [JournalPropertySchema], required: true },
    views: { type: [JournalViewSchema], required: true },
    rows: { type: [JournalRowSchema], required: true, default: [] },
  },
  { timestamps: true },
);

// Only the *default* journal must be unique per user. Non-default
// journals are unconstrained so a user can create as many as they like.
JournalSchema.index(
  { userId: 1 },
  { unique: true, partialFilterExpression: { isDefault: true } },
);
JournalSchema.index({ userId: 1, updatedAt: -1 });

export default mongoose.model<IJournal>("Journal", JournalSchema);
