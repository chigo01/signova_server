export const COMMUNITY_LINKS = {
  telegram: "https://t.me/signova",
  whatsapp: "https://wa.me/0",
  refer: "https://signova.app/refer",
};

export const FROM_EMAIL = "noreply@signova.app";

export const deriveFirstName = (name?: string | null): string => {
  const first = name?.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : "there";
};

export const escapeHtml = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

export const wrapEmail = (bodyHtml: string): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7f9;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;padding:32px;box-shadow:0 1px 2px rgba(0,0,0,0.04);">
            <tr>
              <td style="padding-bottom:24px;border-bottom:1px solid #eef0f3;">
                <span style="font-size:18px;font-weight:700;letter-spacing:0.04em;color:#111827;">SIGNOVA</span>
              </td>
            </tr>
            <tr>
              <td style="padding-top:24px;font-size:15px;line-height:1.6;color:#1f2937;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding-top:32px;border-top:1px solid #eef0f3;font-size:12px;color:#6b7280;">
                Signova &middot; <a href="https://signova.app" style="color:#6b7280;text-decoration:none;">signova.app</a><br/>
                You're receiving this because you're part of the Signova beta.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
