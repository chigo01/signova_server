import mongoose, { Schema, Document } from "mongoose";

export interface IPrediction extends Document {
  symbol: string;
  technicalState: string; // The summary string used for embedding
  embedding: number[];
  recommendation: "BUY" | "HOLD" | "SELL";
  confidence: number;
  reasons: string[];
  timestamp: Date;
  actualOutcome?: string;
  userRating?: number; // 1-5 rating
}

const PredictionSchema = new Schema<IPrediction>(
  {
    symbol: { type: String, required: true, index: true },
    technicalState: { type: String, required: true },
    embedding: { type: [Number], required: true },
    recommendation: { type: String, required: true, enum: ["BUY", "HOLD", "SELL"] },
    confidence: { type: Number, required: true },
    reasons: { type: [String], required: true },
    timestamp: { type: Date, default: Date.now },
    actualOutcome: { type: String },
    userRating: { type: Number, min: 1, max: 5 },
  },
  { timestamps: true }
);

/**
 * Note for Vector Search Implementation:
 * In MongoDB Atlas, you must create a Vector Search Index on this collection.
 * The index name should be "prediction_vector_index".
 * Definition:
 * {
 *   "fields": [
 *     {
 *       "type": "vector",
 *       "path": "embedding",
 *       "numDimensions": 1536,
 *       "similarity": "cosine"
 *     }
 *   ]
 * }
 */

export default mongoose.model<IPrediction>("Prediction", PredictionSchema);
