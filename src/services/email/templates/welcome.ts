import { escapeHtml } from "./_shared";

export interface WelcomeEmailData {
  firstName: string;
}

const AFFILIATE_URL = "https://signova.app/affiliate";
const HOW_IT_WORKS_URL = "https://signova.app/how-it-works";
const DASHBOARD_IMAGE_URL =
  "https://res.cloudinary.com/dkbsmhmwo/image/upload/v1778949240/dashboard_rmpkum.png";
const LOGO_URL =
  "https://res.cloudinary.com/dkbsmhmwo/image/upload/v1778948953/Logo_cni9vm.svg";
const WEBSITE_URL = "https://signova.com";
const WHATSAPP_COMMUNITY_URL = "https://linktr.ee/signovaapp";
const TELEGRAM_COMMUNITY_URL = "https://t.me/signovacommunity";

export const welcomeEmail = (
  data: WelcomeEmailData
): { subject: string; html: string } => {
  const firstName = escapeHtml(data.firstName);

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <title>Welcome to the Signova Beta</title>
    <style>
      :root { color-scheme: light dark; supported-color-schemes: light dark; }
      body, table, td {
        background-color: #000000 !important;
        background-image: linear-gradient(#000000, #000000) !important;
        background-repeat: repeat !important;
      }

      /* Gmail mobile partial-inversion override hooks. Gmail tags elements
         it has rewritten with data-ogsc (color) or data-ogsb (background). */
      body[data-ogsb], table[data-ogsb], td[data-ogsb] {
        background-color: #000000 !important;
        background-image: linear-gradient(#000000, #000000) !important;
      }
      .dark-bg[data-ogsb], .dark-bg[data-ogsc] {
        background-color: #000000 !important;
        background-image: linear-gradient(#000000, #000000) !important;
      }
      .dark-text[data-ogsc] { color: #ffffff !important; }
      .dark-muted[data-ogsc] { color: #9ca3af !important; }
      .dark-soft[data-ogsc] { color: #e5e7eb !important; }
      .dark-btn[data-ogsb] { background-color: #ffffff !important; background-image: linear-gradient(#ffffff, #ffffff) !important; }
      .dark-btn-text[data-ogsc] { color: #000000 !important; }
      .dark-pill[data-ogsc] { border-color: #ffffff !important; color: #ffffff !important; }

      /* prefers-color-scheme rules: Gmail honors these once color-scheme=light dark
         signals "this email manages both modes itself, do not auto-invert".
         Double-class specificity (.dark-text.dark-text) boosts the selector
         above Gmail's injected inline style. */
      @media (prefers-color-scheme: light) {
        body, table, td {
          background-color: #000000 !important;
          background-image: linear-gradient(#000000, #000000) !important;
        }
      }
      @media (prefers-color-scheme: dark) {
        body, table, td {
          background-color: #000000 !important;
          background-image: linear-gradient(#000000, #000000) !important;
        }
        .dark-bg.dark-bg {
          background-color: #000000 !important;
          background-image: linear-gradient(#000000, #000000) !important;
        }
        .dark-text.dark-text { color: #ffffff !important; }
        .dark-muted.dark-muted { color: #9ca3af !important; }
        .dark-soft.dark-soft { color: #e5e7eb !important; }
        .dark-btn-text.dark-btn-text { color: #000000 !important; }
        .dark-pill.dark-pill { color: #ffffff !important; border-color: #ffffff !important; }
        .dark-btn.dark-btn {
          background-color: #ffffff !important;
          background-image: linear-gradient(#ffffff, #ffffff) !important;
        }
        .dark-link.dark-link { color: #ffffff !important; }
      }
    </style>
  </head>
  <body class="dark-bg" bgcolor="#000000" style="margin:0;padding:0;background-color:#000000 !important;background-image:linear-gradient(#000000,#000000);background-repeat:repeat;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#ffffff;">
    <table role="presentation" class="dark-bg" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="background-color:#000000;background-image:linear-gradient(#000000,#000000);background-repeat:repeat;padding:32px 16px;">
      <tr>
        <td class="dark-bg" align="center" bgcolor="#000000" style="background-color:#000000;background-image:linear-gradient(#000000,#000000);background-repeat:repeat;">
          <table role="presentation" class="dark-bg" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="max-width:600px;width:100%;background-color:#000000;background-image:linear-gradient(#000000,#000000);background-repeat:repeat;">
            <tr>
              <td align="center" style="padding:8px 0 24px;">
                <img src="${LOGO_URL}" alt="Signova" height="36" style="display:block;height:36px;width:auto;border:0;outline:none;text-decoration:none;" />
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:0 0 24px;">
                <span class="dark-pill" style="display:inline-block;padding:8px 18px;border:1px solid #ffffff;border-radius:999px;font-size:13px;font-weight:600;color:#ffffff;">You're In!</span>
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:0 0 24px;">
                <h1 class="dark-text" style="margin:0;font-size:44px;line-height:1.1;font-weight:800;color:#ffffff;text-align:center;">Welcome to the<br/>Signova Beta</h1>
              </td>
            </tr>

            <tr>
              <td class="dark-muted" align="center" style="padding:8px 24px 32px;font-size:15px;line-height:1.6;color:#9ca3af;text-align:center;">
                Hey <strong class="dark-text" style="color:#ffffff;">${firstName}</strong>, You made the list. Signova's beta is live and you're one of the few traders getting early access before we open the doors wide. Here's what's live and ready for you right now:
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:0 0 36px;">
                <a href="${AFFILIATE_URL}" class="dark-btn" style="display:inline-block;background:#ffffff;color:#000000;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;font-size:15px;"><span class="dark-btn-text" style="color:#000000;">Join the Affiliate Program</span></a>
              </td>
            </tr>

            <tr>
              <td style="padding:0 16px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td class="dark-soft" style="padding:0 0 18px;font-size:15px;line-height:1.5;color:#e5e7eb;">
                      <span class="dark-muted" style="color:#9ca3af;display:inline-block;width:18px;vertical-align:top;">&bull;</span>
                      <span style="display:inline-block;width:calc(100% - 24px);"><strong class="dark-text" style="color:#ffffff;">Real-time signals from Signova:</strong> We analyse the markets so you don't have to.</span>
                    </td>
                  </tr>
                  <tr>
                    <td class="dark-soft" style="padding:0 0 18px;font-size:15px;line-height:1.5;color:#e5e7eb;">
                      <span class="dark-muted" style="color:#9ca3af;display:inline-block;width:18px;vertical-align:top;">&bull;</span>
                      <span style="display:inline-block;width:calc(100% - 24px);"><strong class="dark-text" style="color:#ffffff;">Instant alerts the moment we publish a new signal.</strong></span>
                    </td>
                  </tr>
                  <tr>
                    <td class="dark-soft" style="padding:0 0 18px;font-size:15px;line-height:1.5;color:#e5e7eb;">
                      <span class="dark-muted" style="color:#9ca3af;display:inline-block;width:18px;vertical-align:top;">&bull;</span>
                      <span style="display:inline-block;width:calc(100% - 24px);"><strong class="dark-text" style="color:#ffffff;">Every signal comes with clear entries, TP1, TP2, and Stop Loss</strong> &mdash; nothing left to guess.</span>
                    </td>
                  </tr>
                  <tr>
                    <td class="dark-soft" style="padding:0 0 4px;font-size:15px;line-height:1.5;color:#e5e7eb;">
                      <span class="dark-muted" style="color:#9ca3af;display:inline-block;width:18px;vertical-align:top;">&bull;</span>
                      <span style="display:inline-block;width:calc(100% - 24px);"><strong class="dark-text" style="color:#ffffff;">Stock Options Signals</strong> which come with our analysis, extended into the options market.</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:0 0 36px;">
                <img src="${DASHBOARD_IMAGE_URL}" width="540" alt="Signova dashboard preview" style="max-width:100%;height:auto;border-radius:12px;display:block;margin:0 auto;" />
              </td>
            </tr>

            <tr>
              <td class="dark-muted" align="center" style="padding:0 24px 32px;font-size:15px;line-height:1.6;color:#9ca3af;text-align:center;">
                You're here early. Your feedback directly shapes what we build next. The inner circle moves on WhatsApp and Telegram &mdash; that's where we post real-time updates, signal discussions, and early announcements.
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:0 0 40px;">
                <a href="${HOW_IT_WORKS_URL}" class="dark-btn" style="display:inline-block;background:#ffffff;color:#000000;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;font-size:15px;"><span class="dark-btn-text" style="color:#000000;">See How It Works</span></a>
              </td>
            </tr>

            <tr>
              <td class="dark-text" align="center" style="padding:0 0 8px;font-size:15px;color:#ffffff;font-weight:600;">Don't miss out.</td>
            </tr>
            <tr>
              <td class="dark-text" align="center" style="padding:0 0 40px;font-size:15px;color:#ffffff;font-weight:600;">The Signova Team</td>
            </tr>

            <tr>
              <td class="dark-muted" align="center" style="padding:0 16px 6px;font-size:13px;color:#9ca3af;">
                Check out our website at <a href="${WEBSITE_URL}" class="dark-text" style="color:#ffffff;text-decoration:none;font-weight:600;">www.signova.com</a>
              </td>
            </tr>
            <tr>
              <td class="dark-muted" align="center" style="padding:0 16px 6px;font-size:13px;color:#9ca3af;">
                Whatsapp community: <a href="${WHATSAPP_COMMUNITY_URL}" class="dark-text" style="color:#ffffff;text-decoration:none;font-weight:600;">linktr.ee/signovaapp</a>
              </td>
            </tr>
            <tr>
              <td class="dark-muted" align="center" style="padding:0 16px 24px;font-size:13px;color:#9ca3af;">
                Telegram Community: <a href="${TELEGRAM_COMMUNITY_URL}" class="dark-text" style="color:#ffffff;text-decoration:none;font-weight:600;">t.me/signovacommunity</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return {
    subject: "You're in! Welcome to the Signova Beta",
    html,
  };
};
