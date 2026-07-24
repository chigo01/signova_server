export interface PublicSignalSource {
  _id?: unknown;
  pair?: unknown;
  direction?: unknown;
  timestamp?: unknown;
  approvedAt?: unknown;
  screenshot?: {
    approvedAt?: unknown;
  } | null;
  entryPrice?: unknown;
  exitTargets?: {
    takeProfit1?: unknown;
  } | null;
}

export function toPublicSignal(signal: PublicSignalSource) {
  return {
    _id: signal._id,
    pair: signal.pair,
    direction: signal.direction,
    timestamp: signal.timestamp,
    // Admin approval time — what the "time since approved" countdown runs off.
    // `timestamp` is only when the engine produced the analysis, which can be
    // well before an admin released the trade.
    approvedAt: signal.approvedAt ?? signal.screenshot?.approvedAt,
    entryPrice: signal.entryPrice,
    takeProfit1: signal.exitTargets?.takeProfit1,
  };
}
