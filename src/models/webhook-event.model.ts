import mongoose, { Document, Schema } from "mongoose";

export interface IWebhookEvent extends Document {
  provider: "bachs" | "aella" | "revenuecat";
  eventId: string;
  type: string;
  createdAt: Date;
  updatedAt: Date;
}

const WebhookEventSchema = new Schema(
  {
    provider: {
      type: String,
      enum: ["bachs", "aella", "revenuecat"],
      required: true,
      default: "bachs",
    },
    eventId: { type: String, required: true, unique: true, index: true },
    type: { type: String, required: true },
  },
  { timestamps: true },
);

export default mongoose.model<IWebhookEvent>("WebhookEvent", WebhookEventSchema);
