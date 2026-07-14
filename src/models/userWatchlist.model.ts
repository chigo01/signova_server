import mongoose, { Document, Schema } from "mongoose";

export type WatchlistAlertStatus = "active" | "plan_paused";

export interface IUserWatchlist extends Document {
  userId: mongoose.Types.ObjectId;
  symbol: string;
  companyName?: string;
  status: WatchlistAlertStatus;
  alertsActiveSince: Date;
  addedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserWatchlistSchema = new Schema<IUserWatchlist>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    symbol: { type: String, required: true, uppercase: true, trim: true },
    companyName: { type: String, trim: true },
    status: {
      type: String,
      enum: ["active", "plan_paused"],
      default: "active",
      index: true,
    },
    alertsActiveSince: { type: Date, required: true, default: Date.now },
    addedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

UserWatchlistSchema.index({ userId: 1, symbol: 1 }, { unique: true });
UserWatchlistSchema.index({ symbol: 1, status: 1 });

export default mongoose.model<IUserWatchlist>(
  "UserWatchlist",
  UserWatchlistSchema,
);
