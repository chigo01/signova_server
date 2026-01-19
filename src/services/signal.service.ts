import SignalPlay from "../models/signalPlay.model";
import { env } from "../config/env";
import { PAGINATION_CONSTANTS } from "../config/constants";

export interface PlaySignalData {
  userId: any;
  signalId: string;
  symbol: string;
  signalType: "buy" | "sell";
  entryPrice: number;
  targetPrice?: number;
  stopLoss?: number;
}

export class SignalService {
  /**
   * Fetch approved signals from admin server
   */
  static async getApprovedSignals(): Promise<any> {
    const response = await fetch(`${env.ADMIN_SERVER_URL}/approved-signals`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Admin server error:", errorText);
      throw new Error(`Failed to fetch signals from admin server: ${errorText}`);
    }

    return await response.json();
  }

  /**
   * Save a signal play for a user
   */
  static async playSignal(data: PlaySignalData) {
    const signalPlay = new SignalPlay({
      userId: data.userId,
      signalId: data.signalId,
      symbol: data.symbol,
      signalType: data.signalType,
      entryPrice: data.entryPrice,
      targetPrice: data.targetPrice,
      stopLoss: data.stopLoss,
      playedAt: new Date(),
    });

    await signalPlay.save();
    return signalPlay;
  }

  /**
   * Get signal history for a user with pagination
   */
  static async getSignalHistory(
    userId: any,
    page?: number,
    limit?: number
  ) {
    const currentPage = page || PAGINATION_CONSTANTS.DEFAULT_PAGE;
    const currentLimit = limit || PAGINATION_CONSTANTS.DEFAULT_LIMIT;
    const skip = (currentPage - 1) * currentLimit;

    const [history, total] = await Promise.all([
      SignalPlay.find({ userId })
        .sort({ playedAt: -1 })
        .skip(skip)
        .limit(currentLimit)
        .lean(),
      SignalPlay.countDocuments({ userId }),
    ]);

    return {
      data: history,
      pagination: {
        page: currentPage,
        limit: currentLimit,
        total,
        totalPages: Math.ceil(total / currentLimit),
      },
    };
  }
}
