import { escapeHtml, formatPriceForEmail, wrapEmail } from "./_shared";

export interface Tp1HitEmailData {
  firstName: string;
  pair: string;
  direction: "BUY" | "SELL" | "HOLD";
  takeProfit1: number;
  takeProfit2: number;
}

export const tp1HitEmail = (
  data: Tp1HitEmailData
): { subject: string; html: string } => {
  const firstName = escapeHtml(data.firstName);
  const pair = escapeHtml(data.pair);
  const direction = escapeHtml(data.direction);
  const tp1 = escapeHtml(formatPriceForEmail(data.takeProfit1, data.pair));
  const tp2 = escapeHtml(formatPriceForEmail(data.takeProfit2, data.pair));

  const html = wrapEmail(`
    <p style="margin:0 0 16px;">Hey ${firstName},</p>

    <p style="margin:0 0 16px;">
      TP1 is done. We called <strong>${direction}</strong> on <strong>${pair}</strong> and the
      first target at <strong>${tp1}</strong> has been hit. The trade is working exactly the way
      we saw it.
    </p>

    <p style="margin:0 0 8px;font-weight:600;">Here's where you stand and what you can do from here:</p>

    <p style="margin:0 0 12px;">
      <strong>Bank the profit now.</strong> Close the trade and lock in the gain. Clean, certain, done.
    </p>

    <p style="margin:0 0 20px;">
      <strong>Let it run to our second target.</strong> Move your stop loss up to your entry price &mdash;
      you're now in a zero-risk position &mdash; and let the trade aim for <strong>${tp2}</strong>.
      If it gets there, you capture the full call. If it pulls back, you close flat.
    </p>

    <p style="margin:0 0 20px;">Both are solid moves. Either way &mdash; we called this right.</p>

    <p style="margin:0 0 16px;">
      If you took profit on this one, share it. Drop a screenshot in the community. Your result is
      proof of what the signal looked like in real life &mdash; and it might be exactly what
      another trader in the beta needed to see today.
    </p>

    <p style="margin:0 0 24px;">
      <a href="https://linktr.ee/signovaapp" style="color:#2563eb;text-decoration:none;font-weight:600;">linktr.ee/signovaapp</a>
    </p>

    <p style="margin:0 0 4px;">More to come.</p>
    <p style="margin:0;">Signova</p>
  `);

  return {
    subject: `We called it. ${data.pair} just hit our first target.`,
    html,
  };
};
