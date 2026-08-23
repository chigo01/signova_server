import mongoose, { Document, Schema } from "mongoose";

import type { HistoricalPlanId } from "../config/plans";

export type ReferralEarningPlanId = HistoricalPlanId;
export type ReferralEarningStatus = "pending" | "available" | "paid";

export interface IReferralEarning extends Document {
  referrerId: mongoose.Types.ObjectId;
  referredUserId: mongoose.Types.ObjectId;
  // The subscription payment that produced this commission. Unique so a given
  // payment can only ever credit the referrer once (idempotency backstop).
  sourceTransactionId: mongoose.Types.ObjectId;
  planId: ReferralEarningPlanId;
  amountUsdMicro: number;
  sigcoinsAwarded: number;
  status: ReferralEarningStatus;
  createdAt: Date;
  updatedAt: Date;
}

const ReferralEarningSchema: Schema = new Schema(
  {
    referrerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    referredUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    sourceTransactionId: {
      type: Schema.Types.ObjectId,
      ref: "Transaction",
      required: true,
      unique: true,
      index: true,
    },
    planId: { type: String, enum: ["pro", "business"], required: true },
    amountUsdMicro: { type: Number, required: true },
    sigcoinsAwarded: { type: Number, required: true, default: 0 },
    status: {
      type: String,
      enum: ["pending", "available", "paid"],
      default: "pending",
    },
  },
  { timestamps: true },
);

export default mongoose.model<IReferralEarning>(
  "ReferralEarning",
  ReferralEarningSchema,
);
