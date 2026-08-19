import mongoose, { Document, Schema } from "mongoose";

export const PAYMENT_SETTINGS_KEY = "default";

export interface IPaymentSettings extends Document {
  key: string;
  paystackEnabled: boolean;
  dextopusEnabled: boolean;
  bachsEnabled: boolean;
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
    paystackEnabled: { type: Boolean, required: true, default: true },
    dextopusEnabled: { type: Boolean, required: true, default: true },
    bachsEnabled: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

export default mongoose.model<IPaymentSettings>(
  "PaymentSettings",
  PaymentSettingsSchema,
);
