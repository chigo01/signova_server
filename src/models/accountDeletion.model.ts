import mongoose, { Document, Schema } from "mongoose";

// Proof-of-deletion audit trail, written once the purge job has finished
// destroying an account. Deliberately holds no PII: the email is stored only as
// a SHA-256 digest so support can answer "was this address deleted, and when?"
// without us retaining the address itself.
//
// `anonymizedRef` is the synthetic ObjectId that replaced the real user id on
// the retained financial rows (transactions, deposits, referral earnings,
// affiliate payouts, SIGcoin ledger). It exists so an accountant can still group
// those rows together; it maps back to nothing.
export interface IAccountDeletion extends Document {
  anonymizedRef: mongoose.Types.ObjectId;
  emailHash: string;
  requestedAt?: Date;
  scheduledFor?: Date;
  purgedAt: Date;
  platform?: string;
  /** true/false when the account had an Apple refresh token, null when it had none. */
  appleTokenRevoked?: boolean | null;
  deletedCounts: Record<string, number>;
  anonymizedCounts: Record<string, number>;
  createdAt: Date;
  updatedAt: Date;
}

const AccountDeletionSchema: Schema = new Schema(
  {
    anonymizedRef: {
      type: Schema.Types.ObjectId,
      required: true,
      index: { unique: true },
    },
    emailHash: { type: String, required: true, index: true },
    requestedAt: { type: Date },
    scheduledFor: { type: Date },
    purgedAt: { type: Date, required: true, default: Date.now },
    platform: { type: String },
    appleTokenRevoked: { type: Boolean, default: null },
    deletedCounts: { type: Schema.Types.Mixed, default: {} },
    anonymizedCounts: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export default mongoose.model<IAccountDeletion>(
  "AccountDeletion",
  AccountDeletionSchema
);
