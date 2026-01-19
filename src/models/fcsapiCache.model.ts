import mongoose, { Schema, Document } from "mongoose";

export interface IFcsapiCache extends Document {
  pair: string;
  signals: object;
  fetchedAt: Date;
  expiresAt: Date;
}

const FcsapiCacheSchema = new Schema<IFcsapiCache>(
  {
    pair: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    signals: {
      type: Schema.Types.Mixed,
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
    },
  },
  {
    timestamps: true,
  }
);

// TTL index to automatically delete expired documents
FcsapiCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<IFcsapiCache>("FcsapiCache", FcsapiCacheSchema);
