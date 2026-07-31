import { escapeHtml, formatPriceForEmail, wrapEmail } from "./_shared";
import { buildSignalAlertSubject } from "../../signalAlertCopy.service";

export interface SlApproachingEmailData {
  firstName: string;
  pair: string;
  stopLoss: number;
  pipsAway?: number;
}

export const slApproachingEmail = (
  data: SlApproachingEmailData
): { subject: string; html: string } => {
  const firstName = escapeHtml(data.firstName);
  const pair = escapeHtml(data.pair);
  const slPrice = escapeHtml(formatPriceForEmail(data.stopLoss, data.pair));
  const pipsAway =
    data.pipsAway !== undefined && Number.isFinite(data.pipsAway)
      ? `${Math.round(data.pipsAway)} pips`
      : "a few pips";

  const html = wrapEmail(`
    <p style="margin:0 0 16px;">Hey ${firstName},</p>

    <p style="margin:0 0 16px;">
      We want to keep you in the picture &mdash; the <strong>${pair}</strong> trade we called is
      being tested right now. Price has come within <strong>${pipsAway}</strong> of our stop loss
      at <strong>${slPrice}</strong>.
    </p>

    <p style="margin:0 0 16px;">
      The trade is still live and we're still watching it. Here's how to think about it:
    </p>

    <p style="margin:0 0 12px;">
      <strong>Stay with the call:</strong> Our stop is at <strong>${slPrice}</strong> for a specific
      reason &mdash; it's the level where the setup is invalidated. We set it there when we had a
      clear head, before the pressure started.
    </p>

    <p style="margin:0 0 20px;">
      <strong>Exit on your terms:</strong> If you'd rather take a smaller managed loss than wait
      for the stop &mdash; that's a valid decision. You know your risk tolerance better than we do.
    </p>

    <p style="margin:0 0 16px;">
      We're not going anywhere. If the stop triggers, you'll hear from us straight away with the
      full picture. We own the outcome either way.
    </p>

    <p style="margin:0 0 4px;">Watching closely.</p>
    <p style="margin:0;">Signova Team</p>
  `);

  return {
    subject: buildSignalAlertSubject({
      alertType: "SL_WARNING",
      pair: data.pair,
      direction: "HOLD",
    }),
    html,
  };
};
