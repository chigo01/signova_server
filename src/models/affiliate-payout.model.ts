import mongoose, { Document, Schema } from "mongoose";

// A manual payout an admin records against an affiliate. Payouts settle an
// affiliate's owed balance: owed = sigcoins * rate - sum(payouts.amountUsdMicro).
export interface IAffiliatePayout extends Document {
  affiliateId: mongoose.Types.ObjectId;
  amountUsdMicro: number;
  method: string; // e.g. "bank_transfer", "crypto", "manual"
  reference?: string; // external txn ref / receipt id
  note?: string;
  createdByEmail: string; // admin who recorded it
  createdAt: Date;
  updatedAt: Date;
}

const AffiliatePayoutSchema: Schema = new Schema(
  {
    affiliateId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    amountUsdMicro: { type: Number, required: true },
    method: { type: String, required: true },
    reference: { type: String },
    note: { type: String },
    createdByEmail: { type: String, required: true },
  },
  { timestamps: true },
);

export default mongoose.model<IAffiliatePayout>(
  "AffiliatePayout",
  AffiliatePayoutSchema,
);
