import mongoose, { Document, Schema } from "mongoose";

export interface IPushBroadcastNotification extends Document {
  dedupKey: string;
  title: string;
  body: string;
  screen?: string;
  recipientCount: number;
  pushTargetCount: number;
  pushSentCount: number;
  pushFailedCount: number;
  pushErrorCodes: string[];
  sentAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PushBroadcastNotificationSchema: Schema = new Schema(
  {
    dedupKey: { type: String, required: true, unique: true, maxlength: 200 },
    title: { type: String, required: true, maxlength: 80 },
    body: { type: String, required: true, maxlength: 240 },
    screen: { type: String, maxlength: 64 },
    recipientCount: { type: Number, default: 0 },
    pushTargetCount: { type: Number, default: 0 },
    pushSentCount: { type: Number, default: 0 },
    pushFailedCount: { type: Number, default: 0 },
    pushErrorCodes: {
      type: [String],
      default: [],
    },
    sentAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export default mongoose.model<IPushBroadcastNotification>(
  "PushBroadcastNotification",
  PushBroadcastNotificationSchema,
);
