import {
  detailsTable,
  escapeHtml,
  formatPriceForEmail,
  wrapEmail,
} from "./_shared";

export interface SignalAdjustedEmailData {
  firstName: string;
  pair: string;
  direction: "BUY" | "SELL" | "HOLD";
  timeframe?: string;
  // Current (new) values
  entryPrice: number;
  takeProfit1: number;
  takeProfit2: number;
  stopLoss: number;
  // Previous values — used to render the before -> after diff. When a previous
  // value is missing or unchanged, that row is omitted.
  previousEntryPrice?: number;
  previousTakeProfit1?: number;
  previousTakeProfit2?: number;
  previousStopLoss?: number;
}

// A field counts as "changed" only when we have a finite previous value that
// differs from the new one. Missing previous values are treated as unchanged so
// we never render a misleading "— -> 1.0850" row.
const changedRow = (
  label: string,
  previous: number | undefined,
  next: number,
  pair: string
): [string, string] | null => {
  if (
    previous === undefined ||
    previous === null ||
    !Number.isFinite(previous) ||
    previous === next
  ) {
    return null;
  }
  const oldStr = escapeHtml(formatPriceForEmail(previous, pair));
  const newStr = escapeHtml(formatPriceForEmail(next, pair));
  return [
    label,
    `<span style="color:#9ca3af;text-decoration:line-through;">${oldStr}</span> &rarr; <strong>${newStr}</strong>`,
  ];
};

export const signalAdjustedEmail = (
  data: SignalAdjustedEmailData,
): { subject: string; html: string } => {
  const pair = escapeHtml(data.pair);
  const direction = escapeHtml(data.direction);
  const firstName = escapeHtml(data.firstName);

  const rows = [
    changedRow("Enter at", data.previousEntryPrice, data.entryPrice, data.pair),
    changedRow("Stop loss", data.previousStopLoss, data.stopLoss, data.pair),
    changedRow("Take profit 1", data.previousTakeProfit1, data.takeProfit1, data.pair),
    changedRow("Take profit 2", data.previousTakeProfit2, data.takeProfit2, data.pair),
  ].filter((row): row is [string, string] => row !== null);

  // If somehow nothing changed (defensive — callers already guard this), fall
  // back to showing the current levels so the email is never empty.
  const tableRows =
    rows.length > 0
      ? rows
      : ([
          ["Enter at", escapeHtml(formatPriceForEmail(data.entryPrice, data.pair))],
          ["Stop loss", escapeHtml(formatPriceForEmail(data.stopLoss, data.pair))],
          ["Take profit 1", escapeHtml(formatPriceForEmail(data.takeProfit1, data.pair))],
          ["Take profit 2", escapeHtml(formatPriceForEmail(data.takeProfit2, data.pair))],
        ] as Array<[string, string]>);

  const html = wrapEmail(`
    <p style="margin:0 0 16px;">Hey ${firstName},</p>

    <p style="margin:0 0 16px;">
      Heads up &mdash; we've adjusted our <strong>${direction}</strong> trade on
      <strong>${pair}</strong>. Here's what changed:
    </p>

    ${detailsTable(tableRows)}

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
      Make sure your levels match the updated plan. We'll keep you posted as the
      trade develops.
    </p>

    <p style="margin:0 0 4px;">Talk soon,</p>
    <p style="margin:0;">Signova</p>
  `);

  return {
    subject: `We've adjusted our ${data.pair} ${data.direction} trade.`,
    html,
  };
};
