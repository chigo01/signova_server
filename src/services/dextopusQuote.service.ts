import { DextopusService, DextopusDepositQuoteResponse } from "./dextopus.service";
import { PRO_PLAN_AMOUNT_USD_MICRO } from "./subscription.service";

export const PROTOCOL_FEE_BPS = 25;
export const DEFAULT_SLIPPAGE_BPS = 300;
export const ESTIMATE_BUFFER_BPS = 50;
export const MAX_ESTIMATE_ATTEMPTS = 5;
export const SOURCES_CACHE_TTL_MS = 10 * 60 * 1000;

const USD_STABLE_SYMBOLS = new Set([
  "usdt",
  "usdc",
  "dai",
  "usde",
  "pyusd",
  "usd₮0",
  "usdh",
  "musd",
  "xdai",
  "rusd",
  "yusd",
  "usdzc",
  "usdm",
  "pusd",
]);

export type AddressKind =
  | "evm"
  | "solana"
  | "tron"
  | "bitcoin"
  | "near"
  | "litecoin"
  | "stellar"
  | "sui"
  | "ton"
  | "xrp";

export interface DepositSource {
  symbol: string;
  blockchain: string;
  chainId: number;
  decimals: number;
  addressKind: AddressKind | null;
  originAsset: string;
  supportsStaticAddress: boolean;
}

export interface DepositSourceChain {
  blockchain: string;
  chainId: number;
  addressKind: AddressKind | null;
  count: number;
  supportsStaticAddress: boolean;
}

export interface NormalizedSources {
  sources: DepositSource[];
  sourceChains: DepositSourceChain[];
}

export interface QuoteLike {
  success?: boolean;
  amountOut?: string;
  minAmountOut?: string;
  depositRequestId?: string;
  depositAddress?: string;
  expiresInSeconds?: number;
  status?: string;
}

const ADDRESS_KIND_VALUES = new Set<AddressKind>([
  "evm",
  "solana",
  "tron",
  "bitcoin",
  "near",
  "litecoin",
  "stellar",
  "sui",
  "ton",
  "xrp",
]);

export function isDigitsOnly(value: string): boolean {
  return /^\d+$/.test(value);
}

export function totalFeeBps(
  partnerFeeBps: number = 0,
  slippageBps: number = DEFAULT_SLIPPAGE_BPS,
): number {
  const partner = Number.isFinite(partnerFeeBps) ? Math.max(0, partnerFeeBps) : 0;
  const slippage = Number.isFinite(slippageBps) ? Math.max(0, slippageBps) : 0;
  return PROTOCOL_FEE_BPS + partner + slippage + ESTIMATE_BUFFER_BPS;
}

export function isUsdStableSymbol(symbol: string): boolean {
  return USD_STABLE_SYMBOLS.has(symbol.trim().toLowerCase());
}

export function formatAtomicAmount(amount: string, decimals: number): string {
  if (!isDigitsOnly(amount)) return amount;
  const safeDecimals = Number.isFinite(decimals) && decimals >= 0 ? decimals : 0;
  if (safeDecimals === 0) return amount.replace(/^0+(?=\d)/, "") || "0";
  const padded = amount.padStart(safeDecimals + 1, "0");
  const whole = padded.slice(0, -safeDecimals).replace(/^0+(?=\d)/, "") || "0";
  const frac = padded.slice(-safeDecimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

export function parseHumanAmount(value: string, decimals: number): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [wholeRaw, fracRaw = ""] = trimmed.split(".");
  if (fracRaw.length > decimals) return null;
  const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";
  const frac = fracRaw.padEnd(decimals, "0");
  const atomic = `${whole}${frac}`.replace(/^0+(?=\d)/, "") || "0";
  return isDigitsOnly(atomic) ? atomic : null;
}

export function estimateStableAmountIn(
  decimals: number,
  feeBps: number,
  requiredOut: bigint = BigInt(PRO_PLAN_AMOUNT_USD_MICRO),
): bigint {
  const safeDecimals = Number.isFinite(decimals) && decimals >= 0 ? decimals : 6;
  // Destination settlement is priced in micro-USD (6 decimals). If the origin
  // stable uses a different scale, convert so 100 USD is still 100 units.
  const scaleDiff = BigInt(safeDecimals - 6);
  const requiredInOrigin =
    scaleDiff >= 0n
      ? requiredOut * 10n ** scaleDiff
      : requiredOut / 10n ** -scaleDiff;
  const bps = BigInt(Math.max(0, feeBps));
  const denom = 10_000n;
  return (requiredInOrigin * (denom + bps) + denom - 1n) / denom;
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

export function scaleAmountToCover(
  probeIn: bigint,
  probeOut: bigint,
  requiredOut: bigint,
  feeBps: number,
): bigint {
  if (probeIn <= 0n || probeOut <= 0n) {
    throw new Error("Probe quote produced no output");
  }
  const bps = BigInt(Math.max(0, feeBps));
  const bufferedRequired = ceilDiv(requiredOut * (10_000n + bps), 10_000n);
  return ceilDiv(probeIn * bufferedRequired, probeOut);
}

function probeAmountForDecimals(decimals: number): bigint {
  const safeDecimals = Number.isFinite(decimals) && decimals >= 0 ? decimals : 18;
  return 10n ** BigInt(safeDecimals);
}

export async function estimateCoveringAmount(params: {
  decimals: number;
  symbol: string;
  requiredOut?: bigint;
  feeBps: number;
  dryQuote: (amountIn: string) => Promise<QuoteLike>;
}): Promise<{ amountIn: string; quote: QuoteLike }> {
  const requiredOut = params.requiredOut ?? BigInt(PRO_PLAN_AMOUNT_USD_MICRO);
  const { decimals, symbol, feeBps, dryQuote } = params;

  let amountIn: bigint;
  if (isUsdStableSymbol(symbol) && (decimals === 6 || decimals === 18)) {
    amountIn = estimateStableAmountIn(decimals, feeBps, requiredOut);
  } else {
    const probe = probeAmountForDecimals(decimals);
    const probeQuote = await dryQuote(probe.toString());
    const probeOut = bestOutput(probeQuote);
    if (!probeOut || probeOut <= 0n) {
      throw new Error("Could not quote this token for a Pro upgrade");
    }
    amountIn = scaleAmountToCover(probe, probeOut, requiredOut, feeBps);
  }

  let lastQuote: QuoteLike | undefined;
  for (let attempt = 0; attempt < MAX_ESTIMATE_ATTEMPTS; attempt += 1) {
    if (amountIn <= 0n) {
      throw new Error("Could not quote this token for a Pro upgrade");
    }
    lastQuote = await dryQuote(amountIn.toString());
    const minOut = minOutput(lastQuote);
    if (minOut !== undefined && minOut >= requiredOut) {
      return { amountIn: amountIn.toString(), quote: lastQuote };
    }
    const observed = bestOutput(lastQuote);
    if (!observed || observed <= 0n) {
      amountIn = ceilDiv(amountIn * 105n, 100n);
      continue;
    }
    const next = scaleAmountToCover(amountIn, observed, requiredOut, feeBps);
    amountIn = next > amountIn ? next : ceilDiv(amountIn * 105n, 100n);
  }

  throw new Error(
    "Quoted output is below the Pro plan price of 100 USD. Try a different token.",
  );
}

function bestOutput(quote: QuoteLike): bigint | undefined {
  const raw = quote.minAmountOut || quote.amountOut;
  if (!raw || !isDigitsOnly(raw)) return undefined;
  return BigInt(raw);
}

function minOutput(quote: QuoteLike): bigint | undefined {
  const raw = quote.minAmountOut || quote.amountOut;
  if (!raw || !isDigitsOnly(raw)) return undefined;
  return BigInt(raw);
}

export function coversProAmount(quote: QuoteLike, requiredOut = PRO_PLAN_AMOUNT_USD_MICRO): boolean {
  const out = minOutput(quote);
  return out !== undefined && out >= BigInt(requiredOut);
}

export function normalizeAddressKind(value: unknown): AddressKind | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return ADDRESS_KIND_VALUES.has(normalized as AddressKind)
    ? (normalized as AddressKind)
    : null;
}

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BITCOIN_ADDRESS =
  /^(bc1[a-z0-9]{25,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|tb1[a-z0-9]{25,87})$/;

export function validateAddressFormat(
  address: string,
  addressKind: AddressKind | null,
): { valid: boolean; reason?: string } {
  const trimmed = address.trim();
  if (!trimmed) {
    return { valid: false, reason: "Address is required" };
  }
  if (!addressKind) {
    return { valid: trimmed.length >= 8 };
  }
  switch (addressKind) {
    case "evm":
      return EVM_ADDRESS.test(trimmed)
        ? { valid: true }
        : { valid: false, reason: "Enter a valid 0x EVM address" };
    case "tron":
      return TRON_ADDRESS.test(trimmed)
        ? { valid: true }
        : { valid: false, reason: "Enter a valid Tron address (starts with T)" };
    case "solana":
      return SOLANA_ADDRESS.test(trimmed)
        ? { valid: true }
        : { valid: false, reason: "Enter a valid Solana address" };
    case "bitcoin":
      return BITCOIN_ADDRESS.test(trimmed)
        ? { valid: true }
        : { valid: false, reason: "Enter a valid Bitcoin address" };
    default:
      return trimmed.length >= 8
        ? { valid: true }
        : { valid: false, reason: "Enter a valid refund address" };
  }
}

export function refundAddressHint(addressKind: AddressKind | null): string {
  switch (addressKind) {
    case "evm":
      return "0x… address on this network";
    case "tron":
      return "Tron address starting with T";
    case "solana":
      return "Solana wallet address";
    case "bitcoin":
      return "Bitcoin address (bc1… or 1…)";
    default:
      return "Refund address on the same network";
  }
}

function asPositiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const n = Math.trunc(value);
  return n >= 0 ? n : null;
}

export function normalizeSources(raw: {
  sources?: Array<Record<string, unknown>>;
  sourceChains?: Array<Record<string, unknown>>;
}): NormalizedSources {
  const sources: DepositSource[] = [];
  for (const item of raw.sources || []) {
    const chainId = asPositiveInt(item.sourceChainId ?? item.chainId);
    const symbol = typeof item.symbol === "string" ? item.symbol.trim() : "";
    const originAsset =
      (typeof item.address === "string" && item.address.trim()) ||
      (typeof item.currency === "string" && item.currency.trim()) ||
      symbol;
    if (chainId === null || !symbol || !originAsset) continue;
    const decimals = asPositiveInt(item.decimals) ?? 18;
    sources.push({
      symbol,
      blockchain:
        typeof item.blockchain === "string" && item.blockchain.trim()
          ? item.blockchain.trim()
          : `chain-${chainId}`,
      chainId,
      decimals,
      addressKind: normalizeAddressKind(item.addressKind),
      originAsset,
      supportsStaticAddress: Boolean(item.supportsStaticAddress),
    });
  }

  const sourceChains: DepositSourceChain[] = (raw.sourceChains || [])
    .map((item) => {
      const chainId = asPositiveInt(item.chainId);
      if (chainId === null) return null;
      return {
        blockchain:
          typeof item.blockchain === "string" && item.blockchain.trim()
            ? item.blockchain.trim()
            : `chain-${chainId}`,
        chainId,
        addressKind: normalizeAddressKind(item.addressKind),
        count: asPositiveInt(item.count) ?? 0,
        supportsStaticAddress: Boolean(item.supportsStaticAddress),
      };
    })
    .filter((item): item is DepositSourceChain => item !== null);

  if (sourceChains.length === 0) {
    const grouped = new Map<number, DepositSourceChain>();
    for (const source of sources) {
      const existing = grouped.get(source.chainId);
      if (existing) {
        existing.count += 1;
        existing.supportsStaticAddress =
          existing.supportsStaticAddress || source.supportsStaticAddress;
      } else {
        grouped.set(source.chainId, {
          blockchain: source.blockchain,
          chainId: source.chainId,
          addressKind: source.addressKind,
          count: 1,
          supportsStaticAddress: source.supportsStaticAddress,
        });
      }
    }
    sourceChains.push(...grouped.values());
  }

  return { sources, sourceChains };
}

export function findDepositSource(
  catalog: NormalizedSources,
  originChainId: number,
  originAsset: string,
): DepositSource | undefined {
  const needle = originAsset.trim().toLowerCase();
  return catalog.sources.find(
    (source) =>
      source.chainId === originChainId &&
      (source.originAsset.toLowerCase() === needle ||
        source.symbol.toLowerCase() === needle),
  );
}

let sourcesCache: { at: number; payload: NormalizedSources } | null = null;

export function clearSourcesCache(): void {
  sourcesCache = null;
}

export class DextopusQuoteService {
  static async getSources(forceRefresh = false): Promise<NormalizedSources> {
    if (
      !forceRefresh &&
      sourcesCache &&
      Date.now() - sourcesCache.at < SOURCES_CACHE_TTL_MS
    ) {
      return sourcesCache.payload;
    }

    const destination = DextopusService.getConfiguredDestination();
    const raw = await DextopusService.getDepositSources({
      destinationAddress: destination.destinationAsset,
      destinationChainId: destination.destinationChainId,
    });
    const payload = normalizeSources({
      sources: (raw.sources || []) as Array<Record<string, unknown>>,
      sourceChains: (raw.sourceChains || []) as Array<Record<string, unknown>>,
    });
    sourcesCache = { at: Date.now(), payload };
    return payload;
  }

  static async findSource(
    originChainId: number,
    originAsset: string,
  ): Promise<DepositSource> {
    const catalog = await this.getSources();
    const source = findDepositSource(catalog, originChainId, originAsset);
    if (!source) {
      throw new Error("This chain and token cannot be used to pay for Pro");
    }
    return source;
  }

  static async dryQuote(params: {
    originChainId: number;
    originAsset: string;
    amount: string;
    refundTo?: string;
    slippageBps?: number;
  }): Promise<DextopusDepositQuoteResponse> {
    const destination = DextopusService.getConfiguredDestination();
    return DextopusService.createDepositRequest({
      originChainId: params.originChainId,
      destinationChainId: destination.destinationChainId,
      originAsset: params.originAsset,
      destinationAsset: destination.destinationAsset,
      amount: params.amount,
      recipient: destination.recipient,
      refundTo: params.refundTo || destination.recipient,
      slippageBps: params.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
      dry: true,
      partnerFees: DextopusService.getPartnerFees(),
    });
  }

  static async estimateProAmount(params: {
    originChainId: number;
    originAsset: string;
    source: DepositSource;
    refundTo?: string;
    slippageBps?: number;
  }): Promise<{ amountIn: string; quote: DextopusDepositQuoteResponse }> {
    const feeBps = totalFeeBps(
      DextopusService.getPartnerFees()?.[0]?.fee,
      params.slippageBps ?? DEFAULT_SLIPPAGE_BPS,
    );
    return estimateCoveringAmount({
      decimals: params.source.decimals,
      symbol: params.source.symbol,
      feeBps,
      dryQuote: (amountIn) =>
        this.dryQuote({
          originChainId: params.originChainId,
          originAsset: params.originAsset,
          amount: amountIn,
          refundTo: params.refundTo,
          slippageBps: params.slippageBps,
        }),
    }) as Promise<{ amountIn: string; quote: DextopusDepositQuoteResponse }>;
  }

  static async validateRefundAddress(
    address: string,
    addressKind: AddressKind | null,
  ): Promise<{ valid: boolean; reason?: string }> {
    const local = validateAddressFormat(address, addressKind);
    if (!local.valid) return local;
    if (!addressKind) return local;

    try {
      const remote = await DextopusService.validateDepositAddress({
        chainType: addressKind,
        address: address.trim(),
      });
      if (remote.valid === false) {
        return {
          valid: false,
          reason: remote.reason || "Refund address is not valid for this network",
        };
      }
    } catch (error) {
      console.warn(
        "Dextopus address validation failed; using local format check:",
        (error as Error).message,
      );
    }
    return { valid: true };
  }
}
