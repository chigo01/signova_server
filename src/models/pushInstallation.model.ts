import mongoose, { Document, Schema } from "mongoose";

export type PushPlatform = "android" | "ios";

export interface IPushInstallation extends Document {
  userId: mongoose.Types.ObjectId;
  installationId: string;
  platform: PushPlatform;
  appVersion?: string;
  enabled: boolean;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PushInstallationSchema = new Schema<IPushInstallation>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    installationId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 4096,
    },
    platform: {
      type: String,
      enum: ["android", "ios"],
      required: true,
    },
    appVersion: { type: String, trim: true, maxlength: 64 },
    enabled: { type: Boolean, default: true, index: true },
    lastSeenAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

PushInstallationSchema.index({ userId: 1, enabled: 1 });

export default mongoose.model<IPushInstallation>(
  "PushInstallation",
  PushInstallationSchema,
);
