import mongoose, { Document, Schema } from "mongoose";

export type TransactionPlanId = "pro" | "business";
export type TransactionProvider = "paystack" | "bachs";

export interface ITransaction extends Document {
  userId: mongoose.Types.ObjectId;
  amount: number;
  planId: TransactionPlanId;
  monthsCount: number;
  status: "pending" | "success" | "failed";
  provider: TransactionProvider;
  paystackReference?: string;
  bachsCheckoutId?: string;
  bachsReference?: string;
  bachsChargeId?: string;
  authorizationUrl: string;
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
      enum: ["pro", "business"],
      required: true,
    },
    monthsCount: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: ["pending", "success", "failed"],
      default: "pending",
    },
    provider: {
      type: String,
      enum: ["paystack", "bachs"],
      default: "paystack",
      required: true,
      index: true,
    },
    paystackReference: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    bachsCheckoutId: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    bachsReference: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    bachsChargeId: { type: String },
    authorizationUrl: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

const Transaction = mongoose.model<ITransaction>("Transaction", TransactionSchema);

/** Rebuild unique indexes so Bachs rows can omit paystackReference. */
export async function ensureTransactionIndexes(): Promise<void> {
  try {
    const indexes = await Transaction.collection.indexes();
    const paystackIdx = indexes.find((idx) => idx.name === "paystackReference_1");
    if (paystackIdx && !paystackIdx.sparse) {
      await Transaction.collection.dropIndex("paystackReference_1");
    }
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 27) {
      console.warn("Could not inspect Transaction indexes:", (error as Error).message);
    }
  }
  await Transaction.syncIndexes();
}

export default Transaction;
