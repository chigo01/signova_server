import assert from "node:assert/strict";
import test from "node:test";
import {
  coversProAmount,
  estimateCoveringAmount,
  estimateStableAmountIn,
  findDepositSource,
  formatAtomicAmount,
  normalizeSources,
  scaleAmountToCover,
  totalFeeBps,
  validateAddressFormat,
} from "../services/dextopusQuote.service";
import { PRO_PLAN_AMOUNT_USD_MICRO } from "../services/subscription.service";

const REQUIRED = BigInt(PRO_PLAN_AMOUNT_USD_MICRO);

test("stable estimator covers the Pro price after fees for 6-decimal USDC", () => {
  const feeBps = totalFeeBps(0, 300);
  const amountIn = estimateStableAmountIn(6, feeBps, REQUIRED);
  assert.ok(amountIn > REQUIRED, "must send more than the Pro price to cover fees");
  // 25 + 300 + 50 = 375 bps ≈ 3.75%
  assert.ok(amountIn < REQUIRED + REQUIRED / 10n, "buffer stays modest");
});

test("18-decimal stable scales to the Pro price plus fees", () => {
  const amountIn = estimateStableAmountIn(18, 0, REQUIRED);
  // micro-USD (6 decimals) scaled up to 18-decimal tokens
  assert.equal(amountIn, REQUIRED * 10n ** 12n);
});

test("scaleAmountToCover applies the fee buffer to a volatile probe", () => {
  // Probe: 1 ETH (1e18) → 3500 USDC (3500e6)
  const next = scaleAmountToCover(
    10n ** 18n,
    3_500_000_000n,
    REQUIRED,
    375,
  );
  assert.ok(next > 0n);
  // ~$39.99 / $3500 * 1e18 * 1.0375 ≈ 0.0119 ETH
  assert.ok(next < 10n ** 18n / 20n);
  assert.ok(next > 10n ** 18n / 120n);
});

test("estimateCoveringAmount accepts a 6-decimal stable without a probe quote", async () => {
  const quotes: string[] = [];
  const result = await estimateCoveringAmount({
    decimals: 6,
    symbol: "USDT",
    feeBps: 375,
    dryQuote: async (amountIn) => {
      quotes.push(amountIn);
      return {
        success: true,
        amountOut: amountIn,
        minAmountOut: amountIn,
      };
    },
  });
  assert.equal(quotes.length, 1);
  assert.ok(coversProAmount(result.quote));
  assert.ok(BigInt(result.amountIn) >= REQUIRED);
});

test("estimateCoveringAmount probes a non-stable then lands above the Pro price", async () => {
  const result = await estimateCoveringAmount({
    decimals: 18,
    symbol: "ETH",
    feeBps: 375,
    dryQuote: async (amountIn) => {
      // 1 ETH = $3500; scale linearly in micro-USD
      const out =
        (BigInt(amountIn) * 3_500_000_000n) / 10n ** 18n;
      return {
        success: true,
        amountOut: out.toString(),
        minAmountOut: out.toString(),
      };
    },
  });
  assert.ok(coversProAmount(result.quote));
  assert.ok(BigInt(result.amountIn) > 0n);
});

test("estimateCoveringAmount retries when the first covering guess is short", async () => {
  let calls = 0;
  const result = await estimateCoveringAmount({
    decimals: 8,
    symbol: "WBTC",
    feeBps: 375,
    dryQuote: async (amountIn) => {
      calls += 1;
      // 1 WBTC (1e8) = $80,000 (80_000e6 micro-USD)
      const out = (BigInt(amountIn) * 80_000_000_000n) / 10n ** 8n;
      // First live guess after the probe is forced below the Pro price.
      const adjusted = calls === 2 ? REQUIRED - 1n : out;
      return {
        success: true,
        amountOut: adjusted.toString(),
        minAmountOut: adjusted.toString(),
      };
    },
  });
  assert.ok(calls >= 3);
  assert.ok(coversProAmount(result.quote));
});

test("estimateCoveringAmount fails when the route never covers Pro", async () => {
  await assert.rejects(
    () =>
      estimateCoveringAmount({
        decimals: 18,
        symbol: "DUST",
        feeBps: 375,
        dryQuote: async () => ({
          success: true,
          amountOut: "1",
          minAmountOut: "1",
        }),
      }),
    /below the Pro plan price/,
  );
});

test("coversProAmount rejects a short quote", () => {
  assert.equal(
    coversProAmount({
      amountOut: String(REQUIRED - 1n),
      minAmountOut: String(REQUIRED - 1n),
    }),
    false,
  );
  assert.equal(
    coversProAmount({
      amountOut: String(REQUIRED),
      minAmountOut: String(REQUIRED),
    }),
    true,
  );
});

test("formatAtomicAmount renders whole and fractional units", () => {
  assert.equal(formatAtomicAmount("100000000", 6), "100");
  assert.equal(formatAtomicAmount("1500000", 6), "1.5");
  assert.equal(formatAtomicAmount("1", 18), "0.000000000000000001");
});

test("normalizeSources maps currency to originAsset and groups chains", () => {
  const catalog = normalizeSources({
    sources: [
      {
        currency: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        symbol: "USDT",
        blockchain: "tron",
        sourceChainId: 728126428,
        decimals: 6,
        addressKind: "tron",
      },
      {
        currency: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        symbol: "USDC",
        blockchain: "base",
        sourceChainId: 8453,
        decimals: 6,
        addressKind: "evm",
      },
    ],
  });
  assert.equal(catalog.sources.length, 2);
  assert.equal(catalog.sourceChains.length, 2);
  const usdt = findDepositSource(
    catalog,
    728126428,
    "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
  );
  assert.ok(usdt);
  assert.equal(usdt?.symbol, "USDT");
  assert.ok(findDepositSource(catalog, 8453, "USDC"));
});

test("validateAddressFormat covers evm / tron / solana / bitcoin", () => {
  assert.equal(
    validateAddressFormat("0x1234567890abcdef1234567890abcdef12345678", "evm")
      .valid,
    true,
  );
  assert.equal(validateAddressFormat("not-an-address", "evm").valid, false);
  assert.equal(
    validateAddressFormat("TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf", "tron").valid,
    true,
  );
  assert.equal(
    validateAddressFormat(
      "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
      "bitcoin",
    ).valid,
    true,
  );
});
