import mongoose, { Document, Schema } from "mongoose";

export const PAYMENT_SETTINGS_KEY = "default";

export interface IPaymentSettings extends Document {
  key: string;
  dextopusEnabled: boolean;
  bachsEnabled: boolean;
  aellaEnabled: boolean;
  /** Bumped when a one-time settings backfill has been applied. */
  settingsRevision: number;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentSettingsSchema = new Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: PAYMENT_SETTINGS_KEY,
    },
    dextopusEnabled: { type: Boolean, required: true, default: true },
    bachsEnabled: { type: Boolean, required: true, default: true },
    aellaEnabled: { type: Boolean, required: true, default: true },
    settingsRevision: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

export default mongoose.model<IPaymentSettings>(
  "PaymentSettings",
  PaymentSettingsSchema,
);
