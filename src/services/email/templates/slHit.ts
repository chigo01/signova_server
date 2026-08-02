import {
  detailsTable,
  escapeHtml,
  formatPriceForEmail,
  wrapEmail,
} from "./_shared";
import { buildSignalAlertSubject } from "../../signalAlertCopy.service";

export interface SlHitEmailData {
  firstName: string;
  pair: string;
  direction: "BUY" | "SELL" | "HOLD";
  entryPrice: number;
  stopLoss: number;
  pipsLoss?: number;
  explanation?: string;
}

export const slHitEmail = (
  data: SlHitEmailData
): { subject: string; html: string } => {
  const firstName = escapeHtml(data.firstName);
  const pair = escapeHtml(data.pair);
  const direction = escapeHtml(data.direction);
  const entry = escapeHtml(formatPriceForEmail(data.entryPrice, data.pair));
  const sl = escapeHtml(formatPriceForEmail(data.stopLoss, data.pair));
  const tradeCost =
    data.pipsLoss !== undefined && Number.isFinite(data.pipsLoss)
      ? `-${Math.round(Math.abs(data.pipsLoss))} pips`
      : "loss closed at stop";
  const explanation = data.explanation?.trim();

  const html = wrapEmail(`
    <p style="margin:0 0 16px;">Hey ${firstName},</p>

    <p style="margin:0 0 16px;">
      We called <strong>${direction}</strong> on <strong>${pair}</strong> at <strong>${entry}</strong>.
      The stop loss at <strong>${sl}</strong> has been triggered and the trade is closed.
    </p>

    ${detailsTable([
      ["We entered at", entry],
      ["Our stop was", sl],
      ["The trade cost", escapeHtml(tradeCost)],
    ])}

    ${
      explanation
        ? `<p style="margin:0 0 8px;font-weight:600;">What happened:</p>
           <p style="margin:0 0 20px;color:#374151;">${escapeHtml(explanation)}</p>`
        : ""
    }

    <p style="margin:0 0 16px;">
      We own this call. The setup made sense when we made it, the level was right, and the market
      moved against us. That happens. What doesn't change is how we manage it &mdash; the stop
      did its job, the loss was defined, and your capital is intact for the next trade.
    </p>

    <p style="margin:0 0 16px;">We'll be back with the next call. That's what we do.</p>

    <p style="margin:0 0 4px;">Talk soon,</p>
    <p style="margin:0;">Signova Team</p>
  `);

  return {
    subject: buildSignalAlertSubject({
      alertType: "SL",
      pair: data.pair,
      direction: data.direction,
    }),
    html,
  };
};
