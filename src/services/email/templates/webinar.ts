import { escapeHtml } from "./_shared";

export const WEBINAR_TITLE =
  "Trade With Structure: Build a Repeatable Forex Trading System";
export const WEBINAR_TIME_LABEL =
  "Saturday, August 29, 2026 · 12:00 PM–1:30 PM WAT";

const GOOGLE_CALENDAR_URL =
  "https://calendar.google.com/calendar/render?action=TEMPLATE" +
  `&text=${encodeURIComponent(WEBINAR_TITLE)}` +
  "&dates=20260829T110000Z/20260829T123000Z" +
  `&details=${encodeURIComponent("Join Signova for a practical live Forex trading webinar.")}`;

function webinarShell(content: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#050505;color:#fff;font-family:Arial,sans-serif"><div style="max-width:620px;margin:0 auto;padding:40px 24px"><div style="font-weight:800;font-size:22px;letter-spacing:.04em">SIGNOVA</div><div style="margin-top:24px;background:#121212;border:1px solid #252525;border-radius:14px;padding:28px">${content}</div><p style="color:#777;font-size:12px;line-height:1.6;margin-top:20px">Trading education is for informational purposes only and does not guarantee results.</p></div></body></html>`;
}

export function webinarConfirmationEmail(input: {
  name: string;
  token: string;
  meetUrl: string;
}): string {
  return webinarShell(`
    <p style="color:#5EEBD0;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Spot reserved</p>
    <h1 style="font-size:28px;line-height:1.15;margin:12px 0">You’re in, ${escapeHtml(input.name)}.</h1>
    <p style="color:#bbb;line-height:1.65">Join us for <strong style="color:#fff">${escapeHtml(WEBINAR_TITLE)}</strong>.</p>
    <div style="margin:24px 0;padding:20px;border:1px solid #2b2b2b;border-radius:10px;background:#080909;text-align:center">
      <p style="margin:0 0 8px;color:#8f9695;font-size:12px;text-transform:uppercase;letter-spacing:.12em">Your raffle token</p>
      <strong style="display:block;color:#5EEBD0;font-size:34px;letter-spacing:.12em">${escapeHtml(input.token)}</strong>
      <p style="margin:10px 0 0;color:#8f9695;font-size:12px">Keep this token. It is your permanent entry for the webinar raffle.</p>
    </div>
    <div style="border-left:3px solid #5EEBD0;padding:4px 0 4px 16px;margin:24px 0"><strong>${escapeHtml(WEBINAR_TIME_LABEL)}</strong><br><span style="color:#999">90 minutes · Online</span></div>
    <a href="${escapeHtml(input.meetUrl)}" style="display:inline-block;background:#5EEBD0;color:#050505;text-decoration:none;font-weight:700;padding:13px 18px;border-radius:7px">Join Google Meet</a>
    <a href="${GOOGLE_CALENDAR_URL}" style="display:inline-block;margin-left:8px;background:#fff;color:#050505;text-decoration:none;font-weight:700;padding:13px 18px;border-radius:7px">Add to calendar</a>
    <p style="color:#bbb;line-height:1.65;margin-top:24px">Your bonuses include community access, guidance and free mentorship, plus a chance to win a prop account subject to eligibility and published terms.</p>
  `);
}

export function webinarInternalNotificationEmail(input: {
  name: string;
  email: string;
  phone: string;
  token: string;
  attribution: Record<string, string>;
}): string {
  const attributionRows = Object.entries(input.attribution)
    .map(
      ([key, value]) =>
        `<li><strong>${escapeHtml(key)}:</strong> ${escapeHtml(value)}</li>`
    )
    .join("");

  return webinarShell(`
    <p style="color:#5EEBD0;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">New registration</p>
    <h1 style="font-size:24px;line-height:1.2;margin:12px 0 20px">${escapeHtml(WEBINAR_TITLE)}</h1>
    <p><strong>Token:</strong> ${escapeHtml(input.token)}</p>
    <p><strong>Name:</strong> ${escapeHtml(input.name)}</p>
    <p><strong>Email:</strong> ${escapeHtml(input.email)}</p>
    <p><strong>WhatsApp / phone:</strong> ${escapeHtml(input.phone)}</p>
    ${attributionRows ? `<h2 style="font-size:16px;margin-top:24px">Campaign attribution</h2><ul style="color:#bbb;line-height:1.7">${attributionRows}</ul>` : ""}
  `);
}
