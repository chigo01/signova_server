/**
 * Curated Korea Exchange board: the largest common listings by market cap.
 * Preferred shares are left out. Quotes are filled in by the KRX scanner.
 *
 * The webapp mirror is signova-webapp/lib/krx.ts (symbols only).
 */
export const KRX_BOARD: ReadonlyArray<{ symbol: string; name: string }> = [
  { symbol: "005930", name: "Samsung Electronics Co., Ltd." },
  { symbol: "000660", name: "SK hynix Inc." },
  { symbol: "402340", name: "SK Square Co., Ltd." },
  { symbol: "009150", name: "Samsung Electro-Mechanics Co., Ltd" },
  { symbol: "005380", name: "Hyundai Motor Company" },
  { symbol: "373220", name: "LG Energy Solution Ltd." },
  { symbol: "207940", name: "SAMSUNG BIOLOGICS Co., Ltd." },
  { symbol: "105560", name: "KB Financial Group Inc." },
  { symbol: "028260", name: "SAMSUNG C&T CORP" },
  { symbol: "012450", name: "Hanwha Aerospace Co., Ltd." },
  { symbol: "034020", name: "Doosan Enerbility Co., Ltd." },
  { symbol: "032830", name: "Samsung Life Insurance Co., Ltd." },
  { symbol: "055550", name: "Shinhan Financial Group Co., Ltd." },
  { symbol: "329180", name: "HD Hyundai Heavy Industries Co., Ltd." },
  { symbol: "000270", name: "Kia Corporation" },
  { symbol: "006400", name: "Samsung SDI Co., Ltd" },
  { symbol: "068270", name: "Celltrion, Inc." },
  { symbol: "086790", name: "Hana Financial Group Inc." },
  { symbol: "066570", name: "LG Electronics Inc." },
  { symbol: "012330", name: "Hyundai Mobis Co., Ltd" },
  { symbol: "034730", name: "SK Inc." },
  { symbol: "010120", name: "LS Electric Co., Ltd." },
  { symbol: "035420", name: "NAVER Corp." },
  { symbol: "298040", name: "Hyosung Heavy Industries Corp." },
  { symbol: "316140", name: "Woori Financial Group, Inc." },
  { symbol: "267260", name: "HD Hyundai Electric" },
  { symbol: "000810", name: "Samsung Fire & Marine Insurance Co., Ltd" },
  { symbol: "042660", name: "Hanwha Ocean Co., Ltd." },
  { symbol: "009540", name: "HD Korea Shipbuilding & Offshore Engineering" },
  { symbol: "005490", name: "POSCO Holdings Inc." },
];

const KRX_SYMBOLS = new Set(KRX_BOARD.map((item) => item.symbol));

export function isKrxSymbol(symbol: string): boolean {
  return KRX_SYMBOLS.has(symbol.trim().toUpperCase());
}

export function krxCompanyName(symbol: string): string {
  const key = symbol.trim().toUpperCase();
  return KRX_BOARD.find((item) => item.symbol === key)?.name ?? key;
}
