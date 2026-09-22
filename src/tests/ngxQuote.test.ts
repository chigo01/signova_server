import test from "node:test";
import assert from "node:assert/strict";
import { NGX_BOARD, isNgxSymbol, ngxCompanyName } from "../config/ngxBoard";
import {
  fallbackNgxBoard,
  quotesFromScannerRows,
} from "../services/ngxQuote.service";
import { KRX_SPEC, quotesFromBoardRows } from "../services/boardQuote.service";

test("NGX catalog recognizes the curated board and rejects US tickers", () => {
  assert.equal(isNgxSymbol("dangcem"), true);
  assert.equal(isNgxSymbol("FIRSTHOLDCO"), true);
  assert.equal(isNgxSymbol("AAPL"), false);
  assert.equal(ngxCompanyName("gtco"), "Guaranty Trust Holding Company Plc");
  assert.equal(NGX_BOARD.length, 30);
});

test("scanner rows become naira quotes in catalog order", () => {
  const listed = quotesFromScannerRows({
    data: [
      {
        s: "NSENG:DANGCEM",
        d: [
          "DANGCEM",
          "Dangote Cement PLC",
          1050,
          1.55,
          16,
          1060,
          1040,
          17414465332031,
          "Non-Energy Minerals",
        ],
      },
      {
        s: "NASDAQ:AAPL",
        d: ["AAPL", "Apple", 200, 1, 2, 201, 199, 1, "Technology"],
      },
      {
        s: "NSENG:ARADEL",
        d: [
          "ARADEL",
          "Aradel Holdings Plc",
          1530,
          -1.2903225806451613,
          -20,
          1550,
          1520,
          6647612431641,
          "Energy Minerals",
        ],
      },
    ],
  });

  assert.equal(listed.length, NGX_BOARD.length);
  assert.equal(listed[0]?.symbol, "AIRTELAFRI");
  assert.equal(listed[0]?.price, 0);
  assert.equal(listed[0]?.name, "Airtel Africa Plc");

  const dangcem = listed.find((item) => item.symbol === "DANGCEM");
  assert.equal(dangcem?.price, 1050);
  assert.equal(dangcem?.change, 16);
  assert.equal(dangcem?.changePercent, 1.55);
  assert.equal(dangcem?.marketCap, 17414465332031);
  assert.equal(dangcem?.currency, "NGN");
  assert.equal(dangcem?.market, "NGX");
  assert.equal(dangcem?.sector, "Non-Energy Minerals");

  const aradel = listed.find((item) => item.symbol === "ARADEL");
  assert.equal(aradel?.changePercent, -1.2903225806451613);
  assert.equal(listed.some((item) => item.symbol === "AAPL"), false);
});

test("Korean scanner rows stay in won and catalog order", () => {
  const listed = quotesFromBoardRows(KRX_SPEC, {
    data: [
      {
        s: "KRX:005930",
        d: [
          "005930",
          "Samsung Electronics Co., Ltd.",
          276500,
          1.2,
          3300,
          278000,
          270000,
          1740782914062500,
          "Electronic Technology",
        ],
      },
    ],
  });

  assert.equal(listed.length, 30);
  assert.equal(listed[0]?.symbol, "005930");
  assert.equal(listed[0]?.price, 276500);
  assert.equal(listed[0]?.currency, "KRW");
  assert.equal(listed[0]?.market, "KRX");
  assert.equal(listed[1]?.symbol, "000660");
  assert.equal(listed[1]?.price, 0);
});

test("fallback board keeps every curated name without a price", () => {
  const board = fallbackNgxBoard();
  assert.equal(board.length, 30);
  assert.ok(board.every((item) => item.price === 0 && item.currency === "NGN"));
});
