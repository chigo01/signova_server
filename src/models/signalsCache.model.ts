import mongoose, { Schema, Document } from "mongoose";

export interface ISignalsCache extends Document {
  cacheKey: string; // "approved-signals"
  signals: object[];
  fetchedAt: Date;
  expiresAt: Date;
}

const SignalsCacheSchema = new Schema<ISignalsCache>(
  {
    cacheKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    signals: {
      type: [Schema.Types.Mixed],
      required: true,
    },
    fetchedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// TTL index to automatically delete expired documents
SignalsCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<ISignalsCache>("SignalsCache", SignalsCacheSchema);
