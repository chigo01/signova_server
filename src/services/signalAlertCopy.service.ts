import type { SignalAlertType } from "../models/signalAlertNotification.model";
import { formatPriceForEmail } from "./email/templates/_shared";

export type SignalAlertCopyPayload = {
  alertType: SignalAlertType;
  pair: string;
  direction: "BUY" | "SELL" | "HOLD";
  entryPrice: number;
  takeProfit1: number;
  takeProfit2: number;
  stopLoss: number;
  timeframe?: string;
  pipsAway?: number;
  pipsLoss?: number;
  reasoning?: string;
  previousEntryPrice?: number;
  previousTakeProfit1?: number;
  previousTakeProfit2?: number;
  previousStopLoss?: number;
};

const price = (value: number | undefined, pair: string): string =>
  formatPriceForEmail(value, pair);

export function buildSignalAlertSubject(
  payload: Pick<
    SignalAlertCopyPayload,
    "alertType" | "pair" | "direction"
  >,
): string {
  switch (payload.alertType) {
    case "NEW_SIGNAL":
      return `We're calling a ${payload.direction} on ${payload.pair} right now.`;
    case "TP1":
      return `We called it. ${payload.pair} just hit our first target.`;
    case "TP2":
      return `Full target. ${payload.pair} ran exactly where we said it would.`;
    case "SL_WARNING":
      return `Head's up — our ${payload.pair} trade is under pressure.`;
    case "SL":
      return `This one didn't go our way. ${payload.pair} hit our stop.`;
    case "SIGNAL_ADJUSTED":
      return `We've adjusted our ${payload.pair} ${payload.direction} trade.`;
  }
}

export function buildSignalAlertPushBody(
  payload: SignalAlertCopyPayload,
  firstName: string,
): string {
  switch (payload.alertType) {
    case "NEW_SIGNAL":
      return (
        `Hey ${firstName}, we've been watching ${payload.pair} and the setup is there. ` +
        `Here's our call: Pair ${payload.pair}. Our call ${payload.direction}. ` +
        `Entry price ${price(payload.entryPrice, payload.pair)}. ` +
        `Timeframe ${payload.timeframe || "—"}. View the full signal in your vault.`
      );
    case "TP1":
      return (
        `Hey ${firstName}, TP1 is done. We called ${payload.direction} on ${payload.pair} ` +
        `and the first target at ${price(payload.takeProfit1, payload.pair)} has been hit. ` +
        "The trade is working exactly the way we saw it."
      );
    case "TP2":
      return (
        `Hey ${firstName}, that's the full trade. We called ${payload.direction} on ` +
        `${payload.pair} at ${price(payload.entryPrice, payload.pair)}, and it ran clean ` +
        `through TP1 at ${price(payload.takeProfit1, payload.pair)} all the way to our ` +
        `second target at ${price(payload.takeProfit2, payload.pair)}. The trade is done.`
      );
    case "SL_WARNING": {
      const distance = Number.isFinite(payload.pipsAway)
        ? `${Math.round(payload.pipsAway!)} pips`
        : "a few pips";
      return (
        `Hey ${firstName}, we want to keep you in the picture — the ${payload.pair} trade ` +
        `we called is being tested right now. Price has come within ${distance} of our ` +
        `stop loss at ${price(payload.stopLoss, payload.pair)}. The trade is still live.`
      );
    }
    case "SL": {
      const loss = Number.isFinite(payload.pipsLoss)
        ? `-${Math.round(Math.abs(payload.pipsLoss!))} pips`
        : "closed at stop";
      return (
        `Hey ${firstName}, we called ${payload.direction} on ${payload.pair} at ` +
        `${price(payload.entryPrice, payload.pair)}. The stop loss at ` +
        `${price(payload.stopLoss, payload.pair)} has been triggered and the trade is ` +
        `closed (${loss}). We'll be back with the next call.`
      );
    }
    case "SIGNAL_ADJUSTED":
      return (
        `Hey ${firstName}, heads up — we've adjusted our ${payload.direction} trade on ` +
        `${payload.pair}. Make sure your levels match the updated plan. ` +
        `Entry ${price(payload.entryPrice, payload.pair)}. Stop loss ` +
        `${price(payload.stopLoss, payload.pair)}. TP1 ` +
        `${price(payload.takeProfit1, payload.pair)}. TP2 ` +
        `${price(payload.takeProfit2, payload.pair)}.`
      );
  }
}
