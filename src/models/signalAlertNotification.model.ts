import mongoose, { Document, Schema } from "mongoose";

export type SignalAlertType =
  | "NEW_SIGNAL"
  | "TP1"
  | "TP2"
  | "SL"
  | "SL_WARNING"
  | "SIGNAL_ADJUSTED";

export interface ISignalAlertNotification extends Document {
  signalId: string;
  alertType: SignalAlertType;
  sentAt: Date;
  recipientCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const SignalAlertNotificationSchema: Schema = new Schema(
  {
    signalId: { type: String, required: true },
    alertType: {
      type: String,
      enum: ["NEW_SIGNAL", "TP1", "TP2", "SL", "SL_WARNING", "SIGNAL_ADJUSTED"],
      required: true,
    },
    sentAt: { type: Date, default: Date.now },
    recipientCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// The unique index on (signalId, alertType) is the actual idempotency guard:
// duplicate webhook deliveries from admin-server (retries, network blips, the
// monitor cycle racing itself) hit a Mongo E11000 instead of emailing twice.
// This is also what stops emails after TP2 or SL — once recorded, that
// (signalId, alertType) tuple can never email again.
SignalAlertNotificationSchema.index(
  { signalId: 1, alertType: 1 },
  { unique: true }
);

export default mongoose.model<ISignalAlertNotification>(
  "SignalAlertNotification",
  SignalAlertNotificationSchema
);
