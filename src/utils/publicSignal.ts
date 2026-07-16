export interface PublicSignalSource {
  _id?: unknown;
  pair?: unknown;
  direction?: unknown;
  timestamp?: unknown;
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
    entryPrice: signal.entryPrice,
    takeProfit1: signal.exitTargets?.takeProfit1,
  };
}
