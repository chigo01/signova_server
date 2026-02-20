import mongoose, { Schema, Document } from "mongoose";

export interface IStocksCache extends Document {
  cacheKey: string;
  data: object;
  fetchedAt: Date;
  expiresAt: Date;
}

const StocksCacheSchema = new Schema<IStocksCache>(
  {
    cacheKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    data: {
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
StocksCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<IStocksCache>("StocksCache", StocksCacheSchema);
