import mongoose, { Document, Schema } from "mongoose";

export type WebinarWinner = {
  registrationId: mongoose.Types.ObjectId;
  token: string;
  name: string;
  email: string;
  phone: string;
};

export interface IWebinarDraw extends Document {
  eventKey: string;
  status: "pending" | "complete";
  cutoffAt: Date;
  eligibleCount?: number;
  algorithm: "hmac-sha256-rank-v1";
  seed: string;
  winners: WebinarWinner[];
  drawnAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const WinnerSchema = new Schema<WebinarWinner>(
  {
    registrationId: { type: Schema.Types.ObjectId, required: true },
    token: { type: String, required: true },
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
  },
  { _id: false }
);

const WebinarDrawSchema = new Schema<IWebinarDraw>(
  {
    eventKey: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ["pending", "complete"],
      default: "pending",
      required: true,
    },
    cutoffAt: { type: Date, required: true },
    eligibleCount: { type: Number },
    algorithm: {
      type: String,
      enum: ["hmac-sha256-rank-v1"],
      default: "hmac-sha256-rank-v1",
      required: true,
    },
    seed: { type: String, required: true, select: false },
    winners: { type: [WinnerSchema], default: [] },
    drawnAt: { type: Date },
  },
  { timestamps: true }
);

const WebinarDraw = mongoose.model<IWebinarDraw>(
  "WebinarDraw",
  WebinarDrawSchema
);

export default WebinarDraw;

export async function ensureWebinarDrawIndexes(): Promise<void> {
  await WebinarDraw.createIndexes();
}
