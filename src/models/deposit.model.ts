import mongoose, { Document, Schema } from "mongoose";

export type DepositStatus =
  | "pending"
  | "awaiting_funds"
  | "processing"
  | "success"
  | "failed"
  | "expired";

export interface IDeposit extends Document {
  userId: mongoose.Types.ObjectId;
  provider: "dextopus";
  type: "account_funding" | "plan_upgrade";
  status: DepositStatus;
  providerStatus?: string;
  executionStatus?: string;
  creditApplied: boolean;
  creditedAt?: Date;
  originChainId: number;
  destinationChainId: number;
  originAsset: string;
  destinationAsset: string;
  amountIn: string;
  quotedAmountOut?: string;
  minAmountOut?: string;
  settledAmountOut?: string;
  depositAddress: string;
  depositRequestId: string;
  upstreamRequestId?: string;
  upstreamQuoteId?: string;
  recipient: string;
  refundTo: string;
  userWalletAddress?: string;
  requiredAmountOut?: string;
  subscriptionApplied: boolean;
  subscriptionAppliedAt?: Date;
  expiresAt?: Date;
  originTransactionHashes: string[];
  destinationTransactionHashes: string[];
  lastSyncedAt?: Date;
  providerPayload?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const DepositSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    provider: { type: String, enum: ["dextopus"], default: "dextopus", required: true },
    type: {
      type: String,
      enum: ["account_funding", "plan_upgrade"],
      default: "account_funding",
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "awaiting_funds", "processing", "success", "failed", "expired"],
      default: "pending",
      required: true,
      index: true,
    },
    providerStatus: { type: String },
    executionStatus: { type: String },
    creditApplied: { type: Boolean, default: false, index: true },
    creditedAt: { type: Date },
    originChainId: { type: Number, required: true },
    destinationChainId: { type: Number, required: true },
    originAsset: { type: String, required: true },
    destinationAsset: { type: String, required: true },
    amountIn: { type: String, required: true },
    quotedAmountOut: { type: String },
    minAmountOut: { type: String },
    settledAmountOut: { type: String },
    depositAddress: { type: String, required: true, index: true },
    depositRequestId: { type: String, required: true, unique: true, index: true },
    upstreamRequestId: { type: String },
    upstreamQuoteId: { type: String },
    recipient: { type: String, required: true },
    refundTo: { type: String, required: true },
    userWalletAddress: { type: String },
    requiredAmountOut: { type: String },
    subscriptionApplied: { type: Boolean, default: false, index: true },
    subscriptionAppliedAt: { type: Date },
    expiresAt: { type: Date },
    originTransactionHashes: { type: [String], default: [] },
    destinationTransactionHashes: { type: [String], default: [] },
    lastSyncedAt: { type: Date },
    providerPayload: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

export default mongoose.model<IDeposit>("Deposit", DepositSchema);
