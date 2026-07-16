import {
  detailsTable,
  escapeHtml,
  formatPriceForEmail,
  wrapEmail,
} from "./_shared";

export interface NewSignalEmailData {
  firstName: string;
  pair: string;
  direction: "BUY" | "SELL" | "HOLD";
  entryPrice: number;
  takeProfit1: number;
  takeProfit2: number;
  stopLoss: number;
  timeframe: string;
  riskLevel?: string;
  reasoning?: string;
}

export const newSignalEmail = (
  data: NewSignalEmailData,
): { subject: string; html: string } => {
  const pair = escapeHtml(data.pair);
  const direction = escapeHtml(data.direction);
  const firstName = escapeHtml(data.firstName);

  const html = wrapEmail(`
    <p style="margin:0 0 16px;">Hey ${firstName},</p>

    <p style="margin:0 0 16px;">
      We've been watching <strong>${pair}</strong> and the setup is there. Here's our call:
    </p>

    ${detailsTable([
      ["Pair", pair],
      ["Our call", direction],
      ["Entry price", escapeHtml(formatPriceForEmail(data.entryPrice, data.pair))],
      ["Stop loss", escapeHtml(formatPriceForEmail(data.stopLoss, data.pair))],
      ["Take profit 1 (TP1)", escapeHtml(formatPriceForEmail(data.takeProfit1, data.pair))],
      ["Take profit 2 (TP2)", escapeHtml(formatPriceForEmail(data.takeProfit2, data.pair))],
      ["Timeframe", escapeHtml(data.timeframe)],
    ])}

    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
      <tr>
        <td style="background:#111827;border-radius:8px;">
          <a href="https://web.signova.app/dashboard/signal-vault"
             style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">
            View full signal in your vault &rarr;
          </a>
        </td>
      </tr>
    </table>

    <p style="margin:0 0 16px;">
      We'll message you when we hit TP1 and when the
      trade closes &mdash; whatever the outcome. Stay tuned.
    </p>

    <p style="margin:0 0 4px;">Talk soon,</p>
    <p style="margin:0;">Signova</p>
  `);

  return {
    subject: `We're calling a ${data.direction} on ${data.pair} right now.`,
    html,
  };
};
