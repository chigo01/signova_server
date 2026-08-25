import mongoose, { Document, Schema } from "mongoose";

export const WEBINAR_EVENT_KEY = "trade-with-structure-2026-08-29";

export type WebinarEmailStatus = "pending" | "sent" | "failed";

export interface IWebinarRegistration extends Document {
  eventKey: string;
  token: string;
  name: string;
  email: string;
  emailNormalized: string;
  phone: string;
  attribution: Record<string, string>;
  confirmationStatus: WebinarEmailStatus;
  confirmationSentAt?: Date;
  lastConfirmationAttemptAt?: Date;
  lastConfirmationError?: string;
  internalNotificationStatus: WebinarEmailStatus;
  internalNotificationSentAt?: Date;
  lastInternalNotificationError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const WebinarRegistrationSchema = new Schema<IWebinarRegistration>(
  {
    eventKey: { type: String, required: true },
    token: { type: String, required: true },
    name: { type: String, required: true },
    email: { type: String, required: true },
    emailNormalized: { type: String, required: true },
    phone: { type: String, required: true },
    attribution: { type: Schema.Types.Mixed, default: {} },
    confirmationStatus: {
      type: String,
      enum: ["pending", "sent", "failed"],
      default: "pending",
      required: true,
    },
    confirmationSentAt: { type: Date },
    lastConfirmationAttemptAt: { type: Date },
    lastConfirmationError: { type: String },
    internalNotificationStatus: {
      type: String,
      enum: ["pending", "sent", "failed"],
      default: "pending",
      required: true,
    },
    internalNotificationSentAt: { type: Date },
    lastInternalNotificationError: { type: String },
  },
  { timestamps: true }
);

WebinarRegistrationSchema.index(
  { eventKey: 1, emailNormalized: 1 },
  { unique: true }
);
WebinarRegistrationSchema.index(
  { eventKey: 1, token: 1 },
  { unique: true }
);
WebinarRegistrationSchema.index({ eventKey: 1, confirmationSentAt: 1 });

const WebinarRegistration = mongoose.model<IWebinarRegistration>(
  "WebinarRegistration",
  WebinarRegistrationSchema
);

export default WebinarRegistration;

export async function ensureWebinarRegistrationIndexes(): Promise<void> {
  await WebinarRegistration.createIndexes();
}
