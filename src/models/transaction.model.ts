import mongoose, { Document, Schema } from "mongoose";

export type TransactionPlanId = "pro" | "business";

export interface ITransaction extends Document {
  userId: mongoose.Types.ObjectId;
  amount: number;
  planId: TransactionPlanId;
  monthsCount: number;
  status: 'pending' | 'success' | 'failed';
  aellaVirtualWalletId: string; // The ID of the virtual account from Aella
  accountNumber: string;
  bankName: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TransactionSchema: Schema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    amount: { type: Number, required: true },
    planId: {
      type: String,
      enum: ['pro', 'business'],
      required: true,
    },
    monthsCount: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ['pending', 'success', 'failed'], default: 'pending' },
    aellaVirtualWalletId: { type: String, required: true },
    accountNumber: { type: String, required: true },
    bankName: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

export default mongoose.model<ITransaction>("Transaction", TransactionSchema);
