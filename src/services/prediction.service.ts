import { VectorService } from "./vector.service";
import Prediction, { IPrediction } from "../models/prediction.model";

export class PredictionService {
  /**
   * Saves a new prediction result into the historical vector memory.
   * This allows the AI to recall this analysis if similar technical states occur in the future.
   */
  static async savePrediction(data: {
    symbol: string;
    technicalState: string;
    recommendation: "BUY" | "HOLD" | "SELL";
    confidence: number;
    reasons: string[];
  }): Promise<string | null> {
    try {
      // 1. Generate embedding for the technical state
      const embedding = await VectorService.generateEmbedding(data.technicalState);

      // 2. Save to database
      const doc = await Prediction.create({
        ...data,
        embedding,
      });

      return (doc._id as any).toString();
    } catch (err) {
      console.error(`Failed to save prediction memory for ${data.symbol}:`, err);
      return null;
    }
  }

  /**
   * Updates a prediction with manual feedback (outcome and rating).
   */
  static async updateFeedback(
    predictionId: string,
    data: { actualOutcome?: string; userRating?: number }
  ): Promise<void> {
    try {
      await Prediction.findByIdAndUpdate(predictionId, data);
    } catch (err) {
      console.error(`Failed to update prediction feedback for ${predictionId}:`, err);
      throw err;
    }
  }

  /**
   * Retrieves historical predictions for a symbol that had a similar technical state.
   */
  static async getHistoricalContext(symbol: string, technicalState: string): Promise<string> {
    try {
      // 1. Generate embedding for the current technical state
      const queryEmbedding = await VectorService.generateEmbedding(technicalState);

      // 2. Search for similar past analysis
      const similar = await VectorService.findSimilarPredictions(symbol, queryEmbedding, 3);

      if (similar.length === 0) return "";

      const historyFormatted = similar
        .map((p) => {
          const date = p.timestamp.toISOString().split("T")[0];
          return `- [${date}] Technicals: "${p.technicalState.slice(0, 150)}..." resulted in a ${p.recommendation} recommendation (Confidence: ${p.confidence}%)`;
        })
        .join("\n");

      return `\n### Historical Analysis Memory (Similar Technical Setups):\n${historyFormatted}\n`;
    } catch (err) {
      console.error(`Failed to retrieve historical context for ${symbol}:`, err);
      return "";
    }
  }
}
