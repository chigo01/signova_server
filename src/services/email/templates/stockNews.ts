import { escapeHtml, wrapEmail } from "./_shared";

export interface StockNewsEmailArticle {
  symbols: string[];
  headline: string;
  source: string;
  publishedAt: Date;
  summary: string;
  whyItMatters: string;
  url: string;
}

function articleBlock(article: StockNewsEmailArticle): string {
  const symbols = article.symbols.map(escapeHtml).join(", ");
  const detailUrl = `https://signova.app/dashboard/stock-detail?ticker=${encodeURIComponent(article.symbols[0] ?? "")}`;
  const published = article.publishedAt.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
  return `
    <div style="margin:0 0 24px;padding:20px;border:1px solid #e5e7eb;border-radius:10px;">
      <div style="font-size:12px;font-weight:700;color:#2563eb;letter-spacing:.06em;">${symbols}</div>
      <h2 style="margin:8px 0 6px;font-size:19px;line-height:1.35;color:#111827;">${escapeHtml(article.headline)}</h2>
      <p style="margin:0 0 14px;font-size:12px;color:#6b7280;">${escapeHtml(article.source)} &middot; ${escapeHtml(published)} UTC</p>
      <p style="margin:0 0 14px;">${escapeHtml(article.summary)}</p>
      <p style="margin:0 0 16px;"><strong>Why it matters:</strong> ${escapeHtml(article.whyItMatters)}</p>
      <a href="${escapeHtml(article.url)}" style="color:#2563eb;font-weight:600;text-decoration:none;">Read the original story &rarr;</a>
      <span style="color:#d1d5db;padding:0 8px;">|</span>
      <a href="${escapeHtml(detailUrl)}" style="color:#2563eb;font-weight:600;text-decoration:none;">View ${escapeHtml(article.symbols[0] ?? "stock")} in Signova</a>
    </div>`;
}

export function stockNewsImmediateEmail(
  firstName: string,
  article: StockNewsEmailArticle,
): { subject: string; html: string } {
  const symbol = article.symbols[0] ?? "Watchlist";
  return {
    subject: `[${symbol}] Important watchlist news: ${article.headline}`,
    html: wrapEmail(`
      <p style="margin:0 0 18px;">Hi ${escapeHtml(firstName)},</p>
      <p style="margin:0 0 20px;">An important development was reported for a stock on your watchlist.</p>
      ${articleBlock(article)}
      <p style="font-size:13px;color:#6b7280;">This is a factual news alert, not investment advice. <a href="https://signova.app/dashboard/settings" style="color:#2563eb;">Manage stock news alerts</a>.</p>
    `),
  };
}

export function stockNewsDigestEmail(
  firstName: string,
  localDate: string,
  articles: StockNewsEmailArticle[],
): { subject: string; html: string } {
  return {
    subject: `Your watchlist news digest • ${localDate}`,
    html: wrapEmail(`
      <p style="margin:0 0 18px;">Hi ${escapeHtml(firstName)},</p>
      <p style="margin:0 0 20px;">Here are the important developments reported for your watchlist.</p>
      ${articles.map(articleBlock).join("")}
      <p style="font-size:13px;color:#6b7280;">This digest contains factual news context, not investment advice. <a href="https://signova.app/dashboard/settings" style="color:#2563eb;">Manage stock news alerts</a>.</p>
    `),
  };
}
