import { COMMUNITY_LINKS, escapeHtml, wrapEmail } from "./_shared";

export interface WelcomeEmailData {
  firstName: string;
}

export const welcomeEmail = (
  data: WelcomeEmailData
): { subject: string; html: string } => {
  const firstName = escapeHtml(data.firstName);
  const html = wrapEmail(`
    <p style="margin:0 0 16px;">Hey ${firstName},</p>

    <p style="margin:0 0 16px;">Welcome to the Signova beta. Starting May 15, we're going to work.</p>

    <p style="margin:0 0 16px;">
      Here's what that looks like. Every time we spot a high-probability setup in the markets, we
      call it &mdash; pair, direction, entry price, two take profit targets, and the exact level
      where we close the trade if it goes against us. You get the full picture before you touch
      a position. No guesswork, no noise. Just our call and our reasoning.
    </p>

    <p style="margin:0 0 16px;">
      We'll keep you updated every step of the way. When our first target hits, we'll tell you.
      When we're approaching the stop loss, we'll flag it before it gets there. And every Friday,
      a full debrief &mdash; how our signals performed, what moved the markets, and what we're
      watching going into next week.
    </p>

    <p style="margin:0 0 16px;">
      For 20 days, you get all of that free. In return, one thing &mdash; tell us what you
      honestly think. Good and bad. Reply directly to any email we send. We read every single one.
    </p>

    <p style="margin:0 0 16px;">
      We've got a community of beta traders already in here, talking through setups and keeping
      each other sharp. Come find us.
    </p>

    <p style="margin:0 0 24px;">
      Join on
      <a href="${COMMUNITY_LINKS.telegram}" style="color:#2563eb;text-decoration:none;font-weight:600;">Telegram</a>
      or
      <a href="${COMMUNITY_LINKS.whatsapp}" style="color:#2563eb;text-decoration:none;font-weight:600;">WhatsApp</a>.
    </p>

    <p style="margin:0 0 24px;">
      And if you know a trader who'd benefit from having Signova in their corner &mdash; bring
      them in. The more serious traders in this beta, the sharper we all get.
    </p>

    <p style="margin:0 0 28px;">
      <a href="${COMMUNITY_LINKS.refer}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;">Refer a Friend &rarr;</a>
    </p>

    <p style="margin:0 0 4px;">Let's get to work.</p>
    <p style="margin:0;">Signova</p>
  `);

  return {
    subject: "You're in. Signova is ready to go to work for you.",
    html,
  };
};
