import {
  COMMUNITY_LINKS,
  escapeHtml,
  formatPriceForEmail,
  wrapEmail,
} from "./_shared";
import { buildSignalAlertSubject } from "../../signalAlertCopy.service";

export interface Tp2HitEmailData {
  firstName: string;
  pair: string;
  direction: "BUY" | "SELL" | "HOLD";
  entryPrice: number;
  takeProfit1: number;
  takeProfit2: number;
}

export const tp2HitEmail = (
  data: Tp2HitEmailData
): { subject: string; html: string } => {
  const firstName = escapeHtml(data.firstName);
  const pair = escapeHtml(data.pair);
  const direction = escapeHtml(data.direction);
  const entry = escapeHtml(formatPriceForEmail(data.entryPrice, data.pair));
  const tp1 = escapeHtml(formatPriceForEmail(data.takeProfit1, data.pair));
  const tp2 = escapeHtml(formatPriceForEmail(data.takeProfit2, data.pair));

  const html = wrapEmail(`
    <p style="margin:0 0 16px;">Hey ${firstName},</p>

    <p style="margin:0 0 16px;">
      That's the full trade. We called <strong>${direction}</strong> on <strong>${pair}</strong>
      at <strong>${entry}</strong>, and it ran clean through TP1 at <strong>${tp1}</strong> all
      the way to our second target at <strong>${tp2}</strong>. Stop loss never touched. The call
      played out from start to finish &mdash; exactly as we mapped it.
    </p>

    <p style="margin:0 0 16px;">If you're still holding, close the position now. The trade is done.</p>

    <p style="margin:0 0 20px;font-weight:600;color:#065f46;">
      Full signal complete. Entry &rarr; TP1 &check; &rarr; TP2 &check;. Both targets hit. Stop loss untouched.
      This is what a clean call looks like.
    </p>

    <p style="margin:0 0 16px;">
      Screenshot this one and share it. A full signal from entry to TP2 is exactly the kind of result
      the community should be seeing &mdash; it shows Signova calling it right, start to finish.
    </p>

    <p style="margin:0 0 24px;">
      <a href="https://linktr.ee/signovaapp" style="color:#2563eb;text-decoration:none;font-weight:600;">linktr.ee/signovaapp</a>
    </p>

    <p style="margin:0 0 16px;">
      And if you've been meaning to tell a trading friend about Signova App &mdash; this is the moment.
      Let the result be your pitch.
    </p>

    <p style="margin:0 0 28px;">
      <a href="${COMMUNITY_LINKS.refer}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;">Refer a Friend &rarr;</a>
    </p>

    <p style="margin:0 0 4px;">We'll have the next one ready.</p>
    <p style="margin:0;">Signova Team</p>
  `);

  return {
    subject: buildSignalAlertSubject({
      alertType: "TP2",
      pair: data.pair,
      direction: data.direction,
    }),
    html,
  };
};
