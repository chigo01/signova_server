export const COMMUNITY_LINKS = {
  telegram: "https://linktr.ee/signovaapp",
  whatsapp: "https://linktr.ee/signovaapp",
  refer: "https://signova.app/refer",
};

export const FROM_EMAIL = "notification@signova.app";

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

// JPY/XAU/BTC trade in whole units so 2 decimals is enough; FX majors need 5
// to keep the pip-fraction (the "3" in 1.07543) visible.
export const formatPriceForEmail = (
  value: number | null | undefined,
  pair?: string
): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const upper = (pair || "").toUpperCase();
  const decimals =
    upper.includes("JPY") || upper.includes("XAU") || upper.includes("BTC")
      ? 2
      : 5;
  return value.toFixed(decimals);
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
                Join our community: <a href="https://linktr.ee/signovaapp" style="color:#6b7280;text-decoration:none;">linktr.ee/signovaapp</a><br/>
                You're receiving this because you're part of the Signova beta.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

export const detailsTable = (
  rows: Array<[string, string]>
): string => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:8px 0 24px;">
    <tbody>
      ${rows
        .map(
          ([label, value]) => `
          <tr>
            <td style="padding:8px 12px;color:#6b7280;width:40%;background:#f9fafb;border-radius:6px 0 0 6px;">${escapeHtml(label)}</td>
            <td style="padding:8px 12px;font-weight:600;background:#f9fafb;border-radius:0 6px 6px 0;">${value}</td>
          </tr>
          <tr><td colspan="2" style="height:6px;line-height:6px;font-size:0;">&nbsp;</td></tr>`
        )
        .join("")}
    </tbody>
  </table>`;
