import mongoose, { Document, Schema } from "mongoose";

// Append-only ledger for the SIGcoin economy. Every earn (+) or spend (-) is a
// row; the denormalized `user.sigcoins` balance is kept in sync alongside it.
export type SigcoinReason =
  | "referral_subscription" // current model: +1 when a referral first subscribes
  | "referral_signup" // legacy
  | "referral_payment" // legacy
  | "redemption"
  | "adjustment";

export interface ISigcoinLedger extends Document {
  userId: mongoose.Types.ObjectId;
  delta: number; // positive = earned, negative = spent
  reason: SigcoinReason;
  refId?: mongoose.Types.ObjectId; // e.g. ReferralEarning that produced this
  balanceAfter: number;
  createdAt: Date;
  updatedAt: Date;
}

const SigcoinLedgerSchema: Schema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    delta: { type: Number, required: true },
    reason: {
      type: String,
      enum: [
        "referral_subscription",
        "referral_signup",
        "referral_payment",
        "redemption",
        "adjustment",
      ],
      required: true,
    },
    refId: { type: Schema.Types.ObjectId },
    balanceAfter: { type: Number, required: true },
  },
  { timestamps: true },
);

export default mongoose.model<ISigcoinLedger>(
  "SigcoinLedger",
  SigcoinLedgerSchema,
);
