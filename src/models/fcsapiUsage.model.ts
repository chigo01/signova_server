import mongoose, { Schema, Document } from "mongoose";

export interface IFcsapiUsage extends Document {
  month: string;
  count: number;
  lastUpdated: Date;
}

const FcsapiUsageSchema = new Schema<IFcsapiUsage>(
  {
    month: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    count: {
      type: Number,
      required: true,
      default: 0,
    },
    lastUpdated: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<IFcsapiUsage>("FcsapiUsage", FcsapiUsageSchema);
