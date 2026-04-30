import OpenAI from "openai";
import { env } from "../config/env";
import Prediction, { IPrediction } from "../models/prediction.model";

export class VectorService {
  private static openai = env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: env.OPENAI_API_KEY })
    : null;

  /**
   * Generates a vector embedding for a given text using OpenAI's text-embedding-3-small model.
   */
  static async generateEmbedding(text: string): Promise<number[]> {
    if (!this.openai) {
      throw new Error("OpenAI API key not configured for embeddings");
    }

    try {
      const response = await this.openai.embeddings.create({
        model: "text-embedding-3-small",
        input: text.replace(/\n/g, " "),
      });

      return response.data[0].embedding;
    } catch (err) {
      console.error("Embedding generation failed:", err);
      throw err;
    }
  }

  /**
   * Performs a vector similarity search for past predictions related to a specific symbol.
   * Note: Requires a Vector Search index named 'prediction_vector_index' in MongoDB Atlas.
   */
  static async findSimilarPredictions(
    symbol: string,
    queryEmbedding: number[],
    limit: number = 3
  ): Promise<IPrediction[]> {
    try {
      return await Prediction.aggregate([
        {
          $vectorSearch: {
            index: "prediction_vector_index",
            path: "embedding",
            queryVector: queryEmbedding,
            numCandidates: limit * 20,
            limit: limit,
            filter: { symbol },
          },
        },
      ]);
    } catch (err) {
      console.error("Vector search failed:", err);
      // Fallback: return most recent predictions if vector search fails
      return Prediction.find({ symbol }).sort({ timestamp: -1 }).limit(limit);
    }
  }
}
