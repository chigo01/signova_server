/**
 * Curated Nigerian Exchange board: the largest listings by market cap.
 * Quotes are filled in by the NGX scanner. This list is the stable order and
 * the fallback when that feed is down, so charts can still open.
 *
 * The webapp mirror is signova-webapp/lib/ngx.ts (symbols only).
 */
export const NGX_BOARD: ReadonlyArray<{ symbol: string; name: string }> = [
  { symbol: "AIRTELAFRI", name: "Airtel Africa Plc" },
  { symbol: "MTNN", name: "MTN Nigeria Communications Plc" },
  { symbol: "DANGCEM", name: "Dangote Cement PLC" },
  { symbol: "BUAFOODS", name: "BUA Foods PLC" },
  { symbol: "BUACEMENT", name: "BUA Cement Plc" },
  { symbol: "SEPLAT", name: "Seplat Energy PLC" },
  { symbol: "FIRSTHOLDCO", name: "First HoldCo Plc" },
  { symbol: "ARADEL", name: "Aradel Holdings Plc" },
  { symbol: "HBMNG", name: "HBM Nigeria PLC" },
  { symbol: "ZENITHBANK", name: "Zenith Bank PLC" },
  { symbol: "GTCO", name: "Guaranty Trust Holding Company Plc" },
  { symbol: "TRANSCOHOT", name: "Transcorp Hotels PLC" },
  { symbol: "STANBIC", name: "Stanbic IBTC Holdings Plc" },
  { symbol: "NB", name: "Nigerian Breweries PLC" },
  { symbol: "PRESCO", name: "Presco PLC" },
  { symbol: "NESTLE", name: "Nestle Nigeria Plc" },
  { symbol: "GEREGU", name: "Geregu Power Plc" },
  { symbol: "UBA", name: "United Bank for Africa PLC" },
  { symbol: "INTBREW", name: "International Breweries PLC" },
  { symbol: "ACCESSCORP", name: "Access Holdings Plc" },
  { symbol: "DANGSUGAR", name: "Dangote Sugar Refinery PLC" },
  { symbol: "TRANSPOWER", name: "Transcorp Power PLC" },
  { symbol: "WEMABANK", name: "Wema Bank PLC" },
  { symbol: "FIDELITYBK", name: "Fidelity Bank PLC" },
  { symbol: "OKOMUOIL", name: "Okomu Oil Palm Co. Plc" },
  { symbol: "ETI", name: "Ecobank Transnational, Inc." },
  { symbol: "GUINNESS", name: "Guinness Nigeria PLC" },
  { symbol: "FCMB", name: "FCMB Group Plc" },
  { symbol: "UNILEVER", name: "Unilever Nigeria PLC" },
  { symbol: "NGXGROUP", name: "Nigerian Exchange Group PLC" },
];

const NGX_SYMBOLS = new Set(NGX_BOARD.map((item) => item.symbol));

export function isNgxSymbol(symbol: string): boolean {
  return NGX_SYMBOLS.has(symbol.trim().toUpperCase());
}

export function ngxCompanyName(symbol: string): string {
  const key = symbol.trim().toUpperCase();
  return NGX_BOARD.find((item) => item.symbol === key)?.name ?? key;
}
