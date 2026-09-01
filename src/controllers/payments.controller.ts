import { Request, Response } from "express";
import crypto from "crypto";
import mongoose from "mongoose";
import Deposit from "../models/deposit.model";
import Transaction, { ITransaction } from "../models/transaction.model";
import User from "../models/user.model";
import { asyncHandler } from "../middleware/asyncHandler";
import {
  effectivePlan,
  effectiveProExpiry,
} from "../services/planEntitlement.service";
import { AppError } from "../middleware/errorHandler";
import {
  BachsService,
  isBachsCheckoutMethod,
} from "../services/bachs.service";
import {
  AellaService,
  aellaAmountsMatch,
  isFailedAellaStatus,
  isSuccessfulAellaStatus,
} from "../services/aella.service";
import { DextopusDepositSyncService } from "../services/dextopusDepositSync.service";
import { DextopusService } from "../services/dextopus.service";
import {
  PaymentSettingsService,
  type PaymentRail,
} from "../services/payment-settings.service";
import WebhookEvent from "../models/webhook-event.model";
import {
  DextopusQuoteService,
  DEFAULT_SLIPPAGE_BPS,
  coversProAmount,
  formatAtomicAmount,
  isDigitsOnly,
  refundAddressHint,
} from "../services/dextopusQuote.service";
import {
  PRO_PLAN_AMOUNT_USD,
  PRO_PLAN_AMOUNT_USD_MICRO,
  SubscriptionService,
} from "../services/subscription.service";
import { PLANS, isPlanId } from "../config/plans";
import { ReferralService } from "../services/referral.service";
import { env } from "../config/env";

const PAYMENT_EXPIRY_MS = 60 * 60 * 1000;

// Collaborators for applySuccessfulPayment. Defaulted to the real DB/services in
// production; overridable in tests so the race-safety branching can be exercised
// without a live MongoDB.
export interface ApplyPaymentDeps {
  /** Atomically flip pending/failed → success; returns the doc iff this caller won. */
  claim: (transaction: ITransaction) => Promise<ITransaction | null>;
  activate: (userId: string, months: number) => Promise<void>;
  creditReferral: (transaction: ITransaction) => Promise<void>;
}

const defaultApplyPaymentDeps: ApplyPaymentDeps = {
  claim: (transaction) =>
    Transaction.findOneAndUpdate(
      { _id: transaction._id, status: { $ne: "success" } },
      { $set: { status: "success" } },
      { new: true },
    ),
  activate: (userId, months) =>
    SubscriptionService.activateOrExtendPro(userId, months),
  creditReferral: (transaction) =>
    ReferralService.creditReferralForPayment(transaction),
};

export async function applySuccessfulPayment(
  transaction: ITransaction,
  deps: ApplyPaymentDeps = defaultApplyPaymentDeps,
): Promise<void> {
  // Atomically claim the transaction: flip pending/failed → success in a single
  // findOneAndUpdate gated on `status !== "success"`. Only the caller that wins
  // the claim gets a document back and proceeds to credit. Concurrent callers —
  // the webhook, the client-driven status poll, and webhook retries —
  // that lose the race get null and skip, preventing the subscription from being
  // extended twice for one payment (audit H1). The in-memory guard this replaces
  // could not prevent this: each caller loaded its own doc and all saw "pending".
  const claimed = await deps.claim(transaction);

  // Reflect the terminal state on the caller's in-memory copy regardless of who
  // won the claim, so a response built from it (getTransactionStatus) is accurate.
  transaction.status = "success";

  // Lost the race — another caller already credited this payment.
  if (!claimed) return;

  const months =
    typeof claimed.monthsCount === "number" && claimed.monthsCount > 0
      ? claimed.monthsCount
      : 1;
  await deps.activate(String(claimed.userId), months);
  // Recurring referral commission: credits the referrer (if any) once per
  // payment. Idempotent and self-contained — never throws into this path.
  await deps.creditReferral(claimed);
}

function ensureAuthenticatedUser(req: Request): string {
  if (!req.user) {
    throw new AppError(401, "Unauthorized");
  }

  return req.user.userId;
}

function formatUsdMicro(amount: number): string {
  return (amount / 1_000_000).toFixed(6).replace(/\.?0+$/, "");
}

function requireDepositConfigured(): void {
  if (!DextopusService.isDepositConfigured()) {
    throw new AppError(
      500,
      "Stablecoin funding is not configured on the server",
    );
  }
}

async function requireRailEnabled(
  rail: PaymentRail,
  disabledMessage: string,
): Promise<void> {
  if (!(await PaymentSettingsService.isEnabled(rail))) {
    throw new AppError(403, disabledMessage);
  }
}

function bachsCallbackUrl(): string {
  try {
    return BachsService.resolveCallbackUrl();
  } catch (error) {
    throw new AppError(400, (error as Error).message);
  }
}

function customerDisplayName(
  name: string | undefined,
  email: string,
): string {
  const trimmed = name?.trim();
  if (trimmed) return trimmed;
  return email.split("@")[0]?.trim() || "Signova customer";
}

export function bachsTransactionQuery(data: {
  checkout_id?: string | null;
  reference?: string | null;
}): { bachsCheckoutId: string } | { bachsReference: string } | null {
  if (typeof data.checkout_id === "string" && data.checkout_id.trim()) {
    return { bachsCheckoutId: data.checkout_id.trim() };
  }
  if (typeof data.reference === "string" && data.reference.trim()) {
    return { bachsReference: data.reference.trim() };
  }
  return null;
}

/** Mongo `_id` or Bachs `chk_…` from the hosted-checkout return URL. */
export function ownedTransactionLookup(
  userId: string,
  id: string,
): { _id: string; userId: string } | { bachsCheckoutId: string; userId: string } | null {
  const value = id.trim();
  if (!value) return null;
  if (/^[a-fA-F0-9]{24}$/.test(value)) {
    return { _id: value, userId };
  }
  return { bachsCheckoutId: value, userId };
}

function parseOrigin(body: unknown): {
  originChainId: number;
  originAsset: string;
} {
  const payload = (body ?? {}) as {
    originChainId?: unknown;
    originAsset?: unknown;
  };
  if (typeof payload.originChainId !== "number" || !Number.isFinite(payload.originChainId)) {
    throw new AppError(400, "originChainId is required");
  }
  if (typeof payload.originAsset !== "string" || !payload.originAsset.trim()) {
    throw new AppError(400, "originAsset is required");
  }
  return {
    originChainId: payload.originChainId,
    originAsset: payload.originAsset.trim(),
  };
}

export const listPaymentMethods = asyncHandler(
  async (req: Request, res: Response) => {
    ensureAuthenticatedUser(req);
    const methods = await PaymentSettingsService.getMethods();
    res.status(200).json(methods);
  },
);

export const generateBachsUpgradePayment = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    if (!BachsService.isConfigured()) {
      throw new AppError(500, "Bachs checkout is not configured");
    }
    await requireRailEnabled(
      "bachs",
      "Bachs checkout is currently disabled",
    );

    const { planId, paymentMethod } = req.body ?? {};
    if (!isPlanId(planId)) {
      throw new AppError(400, "planId is required and must be 'pro'");
    }
    if (!isBachsCheckoutMethod(paymentMethod)) {
      throw new AppError(
        400,
        "paymentMethod is required and must be 'card', 'bank_transfer', or 'crypto'",
      );
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new AppError(404, "User not found");
    }

    const plan = PLANS[planId];
    const reference = `signova_bachs_${planId}_${userId}_${crypto
      .randomBytes(6)
      .toString("hex")}`;
    const callbackUrl = bachsCallbackUrl();
    const expiresAt = new Date(Date.now() + PAYMENT_EXPIRY_MS);

    const transaction = await Transaction.create({
      userId,
      amount: plan.displayUsd,
      planId,
      monthsCount: plan.months,
      status: "pending",
      provider: "bachs",
      bachsReference: reference,
      bachsPaymentMethod: paymentMethod,
      authorizationUrl: "pending",
      expiresAt,
    });

    let checkout;
    try {
      checkout = await BachsService.createCheckoutSession({
        email: user.email,
        name: customerDisplayName(user.name, user.email),
        amountUsd: plan.displayUsd,
        paymentMethod,
        reference,
        successUrl: callbackUrl,
        cancelUrl: callbackUrl,
        metadata: {
          userId: String(user._id),
          planId,
          monthsCount: plan.months,
          paymentMethod,
          transactionId: String(transaction._id),
        },
      });
    } catch (error) {
      transaction.status = "failed";
      await transaction.save();
      throw new AppError(
        502,
        (error as Error).message || "Failed to create Bachs checkout",
      );
    }

    transaction.bachsCheckoutId = checkout.checkoutId;
    transaction.authorizationUrl = checkout.checkoutUrl;
    if (checkout.expiresAt) {
      const parsed = new Date(checkout.expiresAt);
      if (!Number.isNaN(parsed.getTime())) {
        transaction.expiresAt = parsed;
      }
    }
    await transaction.save();

    res.status(200).json({
      message: "Payment initialized",
      transactionId: String(transaction._id),
      planId,
      monthsCount: plan.months,
      provider: "bachs",
      bachsPaymentMethod: paymentMethod,
      authorizationUrl: checkout.checkoutUrl,
      reference,
      amount: plan.displayUsd,
      displayUsd: plan.displayUsd,
      expiresAt: transaction.expiresAt,
    });
  },
);

export const generateAellaUpgradePayment = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    if (!AellaService.isConfigured()) {
      throw new AppError(500, "Aella NGN checkout is not configured");
    }
    await requireRailEnabled(
      "aella",
      "Aella NGN bank transfer is currently disabled",
    );

    const { planId } = req.body ?? {};
    if (!isPlanId(planId)) {
      throw new AppError(400, "planId is required and must be 'pro'");
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new AppError(404, "User not found");
    }

    const plan = PLANS[planId];
    let amountNgn: string;
    try {
      amountNgn = await BachsService.resolveNgnAmount(plan.displayUsd);
    } catch (error) {
      throw new AppError(
        502,
        (error as Error).message || "Failed to quote NGN amount for Aella checkout",
      );
    }

    const expiresAt = new Date(Date.now() + PAYMENT_EXPIRY_MS);
    const transaction = await Transaction.create({
      userId,
      amount: plan.displayUsd,
      planId,
      monthsCount: plan.months,
      status: "pending",
      provider: "aella",
      authorizationUrl: "in-app",
      aellaAmountNgn: Number(amountNgn),
      expiresAt,
    });

    let account;
    try {
      account = await AellaService.createDynamicVirtualAccount({
        accountName: "Signova Pro",
        amountNgn,
      });
    } catch (error) {
      transaction.status = "failed";
      await transaction.save();
      throw new AppError(
        502,
        (error as Error).message || "Failed to create Aella virtual account",
      );
    }

    transaction.aellaWalletId = account.id;
    transaction.aellaAccountNumber = account.accountNumber;
    transaction.aellaAccountName = account.accountName;
    transaction.aellaBankName = account.bankName;
    transaction.aellaAmountNgn = account.amountNgn;
    transaction.expiresAt = account.expiresAt;
    await transaction.save();

    res.status(200).json({
      message: "Payment initialized",
      transactionId: String(transaction._id),
      planId,
      monthsCount: plan.months,
      provider: "aella",
      authorizationUrl: "in-app",
      reference: account.accountNumber,
      amount: plan.displayUsd,
      displayUsd: plan.displayUsd,
      amountNgn: account.amountNgn,
      accountNumber: account.accountNumber,
      accountName: account.accountName,
      bankName: account.bankName,
      expiresAt: transaction.expiresAt,
    });
  },
);

export const listDepositSources = asyncHandler(
  async (req: Request, res: Response) => {
    ensureAuthenticatedUser(req);
    requireDepositConfigured();
    await requireRailEnabled(
      "dextopus",
      "Crypto wallet payments are currently disabled",
    );

    const catalog = await DextopusQuoteService.getSources();
    res.status(200).json({
      requiredAmountOut: String(PRO_PLAN_AMOUNT_USD_MICRO),
      requiredAmountUsd: PRO_PLAN_AMOUNT_USD,
      sources: catalog.sources,
      sourceChains: catalog.sourceChains,
    });
  },
);

export const previewStablecoinDeposit = asyncHandler(
  async (req: Request, res: Response) => {
    ensureAuthenticatedUser(req);
    requireDepositConfigured();
    await requireRailEnabled(
      "dextopus",
      "Crypto wallet payments are currently disabled",
    );

    const { originChainId, originAsset } = parseOrigin(req.body);
    let source;
    try {
      source = await DextopusQuoteService.findSource(
        originChainId,
        originAsset,
      );
    } catch (error) {
      throw new AppError(400, (error as Error).message);
    }

    let estimated;
    try {
      estimated = await DextopusQuoteService.estimateProAmount({
        originChainId,
        originAsset: source.originAsset,
        source,
      });
    } catch (error) {
      throw new AppError(
        400,
        (error as Error).message || "Could not quote this token for Pro",
      );
    }

    const coversPro = coversProAmount(estimated.quote);
    res.status(200).json({
      originChainId,
      originAsset: source.originAsset,
      symbol: source.symbol,
      blockchain: source.blockchain,
      addressKind: source.addressKind,
      decimals: source.decimals,
      refundHint: refundAddressHint(source.addressKind),
      amountIn: estimated.amountIn,
      amountInDisplay: formatAtomicAmount(estimated.amountIn, source.decimals),
      amountOut: estimated.quote.amountOut,
      minAmountOut: estimated.quote.minAmountOut,
      amountOutDisplay: estimated.quote.amountOut
        ? formatAtomicAmount(estimated.quote.amountOut, 6)
        : undefined,
      coversPro,
      requiredAmountOut: String(PRO_PLAN_AMOUNT_USD_MICRO),
      requiredAmountUsd: PRO_PLAN_AMOUNT_USD,
      expiresInSeconds: estimated.quote.expiresInSeconds,
    });
  },
);

export const validateDepositRefundAddress = asyncHandler(
  async (req: Request, res: Response) => {
    ensureAuthenticatedUser(req);
    requireDepositConfigured();
    await requireRailEnabled(
      "dextopus",
      "Crypto wallet payments are currently disabled",
    );

    const { originChainId, originAsset } = parseOrigin(req.body);
    const refundTo =
      typeof req.body?.refundTo === "string" ? req.body.refundTo.trim() : "";
    if (!refundTo) {
      throw new AppError(400, "refundTo is required");
    }

    let source;
    try {
      source = await DextopusQuoteService.findSource(
        originChainId,
        originAsset,
      );
    } catch (error) {
      throw new AppError(400, (error as Error).message);
    }
    const result = await DextopusQuoteService.validateRefundAddress(
      refundTo,
      source.addressKind,
    );
    if (!result.valid) {
      throw new AppError(400, result.reason || "Invalid refund address");
    }

    res.status(200).json({
      valid: true,
      addressKind: source.addressKind,
      refundHint: refundAddressHint(source.addressKind),
    });
  },
);

export const createStablecoinDeposit = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    requireDepositConfigured();
    await requireRailEnabled(
      "dextopus",
      "Crypto wallet payments are currently disabled",
    );

    const { originChainId, originAsset } = parseOrigin(req.body);
    const {
      amount,
      refundTo,
      slippageBps,
    } = req.body as {
      amount?: unknown;
      refundTo?: unknown;
      slippageBps?: unknown;
    };

    if (!refundTo || typeof refundTo !== "string" || !refundTo.trim()) {
      throw new AppError(400, "refundTo is required");
    }

    if (
      amount !== undefined &&
      (typeof amount !== "string" || !isDigitsOnly(amount))
    ) {
      throw new AppError(400, "amount must be a whole number in smallest units");
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new AppError(404, "User not found");
    }

    let source;
    try {
      source = await DextopusQuoteService.findSource(
        originChainId,
        originAsset,
      );
    } catch (error) {
      throw new AppError(400, (error as Error).message);
    }
    const refundCheck = await DextopusQuoteService.validateRefundAddress(
      refundTo,
      source.addressKind,
    );
    if (!refundCheck.valid) {
      throw new AppError(400, refundCheck.reason || "Invalid refund address");
    }

    const resolvedSlippage =
      typeof slippageBps === "number" &&
      slippageBps >= 0 &&
      slippageBps <= 10000
        ? slippageBps
        : DEFAULT_SLIPPAGE_BPS;

    let amountIn = amount;
    if (!amountIn) {
      try {
        const estimated = await DextopusQuoteService.estimateProAmount({
          originChainId,
          originAsset: source.originAsset,
          source,
          refundTo: refundTo.trim(),
          slippageBps: resolvedSlippage,
        });
        amountIn = estimated.amountIn;
      } catch (error) {
        throw new AppError(
          400,
          (error as Error).message || "Could not quote this token for Pro",
        );
      }
    }

    const destination = DextopusService.getConfiguredDestination();
    const partnerFees = DextopusService.getPartnerFees();
    const quote = await DextopusService.createDepositRequest({
      originChainId,
      destinationChainId: destination.destinationChainId,
      originAsset: source.originAsset,
      destinationAsset: destination.destinationAsset,
      amount: amountIn,
      recipient: destination.recipient,
      refundTo: refundTo.trim(),
      user: userId,
      slippageBps: resolvedSlippage,
      partnerFees,
    });

    if (!quote.success || !quote.depositRequestId || !quote.depositAddress) {
      throw new AppError(502, "Failed to create Dextopus deposit request");
    }

    if (!coversProAmount(quote)) {
      throw new AppError(
        400,
        `Quoted stablecoin output is below the Pro plan price of ${PRO_PLAN_AMOUNT_USD} USD`,
      );
    }

    const expiresAt =
      typeof quote.expiresInSeconds === "number"
        ? new Date(Date.now() + quote.expiresInSeconds * 1000)
        : undefined;

    const deposit = await new Deposit({
      userId,
      provider: "dextopus",
      type: "plan_upgrade",
      status: "awaiting_funds",
      providerStatus: quote.status,
      originChainId,
      destinationChainId: destination.destinationChainId,
      originAsset: source.originAsset,
      destinationAsset: destination.destinationAsset,
      amountIn,
      quotedAmountOut: quote.amountOut,
      minAmountOut: quote.minAmountOut,
      depositAddress: quote.depositAddress,
      depositRequestId: quote.depositRequestId,
      upstreamRequestId: quote.upstreamRequestId,
      upstreamQuoteId: quote.upstreamQuoteId,
      recipient: destination.recipient,
      refundTo: refundTo.trim(),
      userWalletAddress: refundTo.trim(),
      requiredAmountOut: String(PRO_PLAN_AMOUNT_USD_MICRO),
      expiresAt,
      providerPayload: quote as unknown as Record<string, unknown>,
    }).save();

    res.status(201).json({
      message: "Deposit address created successfully",
      deposit: {
        id: deposit._id,
        type: deposit.type,
        status: deposit.status,
        originChainId: deposit.originChainId,
        originAsset: deposit.originAsset,
        symbol: source.symbol,
        blockchain: source.blockchain,
        addressKind: source.addressKind,
        decimals: source.decimals,
        amountIn: deposit.amountIn,
        amountInDisplay: formatAtomicAmount(deposit.amountIn, source.decimals),
        quotedAmountOut: deposit.quotedAmountOut,
        minAmountOut: deposit.minAmountOut,
        depositAddress: deposit.depositAddress,
        depositRequestId: deposit.depositRequestId,
        expiresAt: deposit.expiresAt,
        requiredAmountOut: deposit.requiredAmountOut,
      },
    });
  },
);

export const getStablecoinDeposit = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError(400, "Invalid deposit id");
    }

    const deposit = await Deposit.findOne({ _id: id, userId });
    if (!deposit) {
      throw new AppError(404, "Deposit not found");
    }

    const syncedDeposit =
      (deposit.status === "success" &&
        (deposit.creditApplied || deposit.subscriptionApplied)) ||
      deposit.status === "failed" ||
      deposit.status === "expired"
        ? deposit
        : await DextopusDepositSyncService.syncDeposit(deposit);

    const user = await User.findById(userId);
    if (!user) {
      throw new AppError(404, "User not found");
    }

    let sourceMeta:
      | {
          symbol?: string;
          blockchain?: string;
          addressKind?: string | null;
          decimals?: number;
        }
      | undefined;
    try {
      const source = await DextopusQuoteService.findSource(
        syncedDeposit.originChainId,
        syncedDeposit.originAsset,
      );
      sourceMeta = {
        symbol: source.symbol,
        blockchain: source.blockchain,
        addressKind: source.addressKind,
        decimals: source.decimals,
      };
    } catch {
      sourceMeta = undefined;
    }

    res.status(200).json({
      message: "Deposit retrieved successfully",
      deposit: {
        id: syncedDeposit._id,
        type: syncedDeposit.type,
        status: syncedDeposit.status,
        providerStatus: syncedDeposit.providerStatus,
        executionStatus: syncedDeposit.executionStatus,
        originChainId: syncedDeposit.originChainId,
        originAsset: syncedDeposit.originAsset,
        symbol: sourceMeta?.symbol,
        blockchain: sourceMeta?.blockchain,
        addressKind: sourceMeta?.addressKind,
        decimals: sourceMeta?.decimals,
        amountIn: syncedDeposit.amountIn,
        amountInDisplay:
          sourceMeta?.decimals !== undefined
            ? formatAtomicAmount(syncedDeposit.amountIn, sourceMeta.decimals)
            : undefined,
        quotedAmountOut: syncedDeposit.quotedAmountOut,
        settledAmountOut: syncedDeposit.settledAmountOut,
        depositAddress: syncedDeposit.depositAddress,
        depositRequestId: syncedDeposit.depositRequestId,
        originTransactionHashes: syncedDeposit.originTransactionHashes,
        destinationTransactionHashes:
          syncedDeposit.destinationTransactionHashes,
        creditApplied: syncedDeposit.creditApplied,
        creditedAt: syncedDeposit.creditedAt,
        requiredAmountOut: syncedDeposit.requiredAmountOut,
        subscriptionApplied: syncedDeposit.subscriptionApplied,
        subscriptionAppliedAt: syncedDeposit.subscriptionAppliedAt,
        expiresAt: syncedDeposit.expiresAt,
        createdAt: syncedDeposit.createdAt,
        updatedAt: syncedDeposit.updatedAt,
      },
      balance: {
        plan: effectivePlan(user),
        proPlanExpiry: user.proPlanExpiry,
        balanceUsdMicro: user.balanceUsdMicro,
        balanceUsd: formatUsdMicro(user.balanceUsdMicro),
      },
    });
  },
);

export const submitStablecoinDepositHash = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    requireDepositConfigured();
    await requireRailEnabled(
      "dextopus",
      "Crypto wallet payments are currently disabled",
    );
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError(400, "Invalid deposit id");
    }

    const txHash =
      typeof req.body?.txHash === "string" ? req.body.txHash.trim() : "";
    if (!txHash) {
      throw new AppError(400, "txHash is required");
    }

    const deposit = await Deposit.findOne({ _id: id, userId });
    if (!deposit) {
      throw new AppError(404, "Deposit not found");
    }

    try {
      await DextopusService.submitDepositTransaction({
        depositRequestId: deposit.depositRequestId,
        depositAddress: deposit.depositAddress,
        txHash,
      });
    } catch (error) {
      throw new AppError(
        502,
        (error as Error).message || "Failed to submit transaction hash",
      );
    }

    const hashes = new Set(deposit.originTransactionHashes || []);
    hashes.add(txHash);
    deposit.originTransactionHashes = Array.from(hashes);
    if (deposit.status === "awaiting_funds" || deposit.status === "pending") {
      deposit.status = "processing";
    }
    await deposit.save();

    const synced = await DextopusDepositSyncService.syncDeposit(deposit);

    res.status(200).json({
      message: "Transaction hash submitted",
      txHash,
      deposit: {
        id: synced._id,
        status: synced.status,
        originTransactionHashes: synced.originTransactionHashes,
      },
    });
  },
);

export const getFundingBalance = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    const user = await User.findById(userId);

    if (!user) {
      throw new AppError(404, "User not found");
    }

    res.status(200).json({
      plan: effectivePlan(user),
      proPlanExpiry: effectiveProExpiry(user),
      mobileSubscription: user.mobileSubscription,
      balanceUsdMicro: user.balanceUsdMicro,
      balanceUsd: formatUsdMicro(user.balanceUsdMicro),
    });
  },
);

export const getTransactionStatus = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    const { id } = req.params;
    const query = ownedTransactionLookup(userId, id ?? "");
    if (!query) {
      throw new AppError(400, "Invalid transaction id");
    }

    const transaction = await Transaction.findOne(query);
    if (!transaction) {
      throw new AppError(404, "Transaction not found");
    }

    if (
      transaction.status === "pending" &&
      transaction.expiresAt.getTime() > Date.now()
    ) {
      if (transaction.provider === "bachs" && transaction.bachsCheckoutId) {
        try {
          const session = await BachsService.getCheckoutSession(
            transaction.bachsCheckoutId,
          );
          if (session.chargeId && !transaction.bachsChargeId) {
            transaction.bachsChargeId = session.chargeId;
          }
          if (BachsService.isSuccessfulCheckout(session)) {
            await applySuccessfulPayment(transaction);
          } else if (BachsService.isFailedCheckout(session)) {
            transaction.status = "failed";
            await transaction.save();
          }
        } catch (err) {
          console.warn(
            `Bachs verify fallback failed for ${transaction.bachsCheckoutId}:`,
            (err as Error).message,
          );
        }
      } else if (
        transaction.provider === "aella" &&
        transaction.aellaAccountNumber
      ) {
        try {
          const inward = await AellaService.getDynamicAccountTransaction(
            transaction.aellaAccountNumber,
          );
          if (
            isSuccessfulAellaStatus(inward.status) &&
            aellaAmountsMatch(transaction.aellaAmountNgn ?? 0, inward.amount)
          ) {
            await applySuccessfulPayment(transaction);
          } else if (isFailedAellaStatus(inward.status)) {
            transaction.status = "failed";
            await transaction.save();
          }
        } catch (err) {
          console.warn(
            `Aella verify fallback failed for ${transaction.aellaAccountNumber}:`,
            (err as Error).message,
          );
        }
      }
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new AppError(404, "User not found");
    }

    const plan =
      transaction.planId === "pro" ? PLANS.pro : undefined;

    res.status(200).json({
      id: String(transaction._id),
      status: transaction.status,
      planId: transaction.planId,
      monthsCount: transaction.monthsCount,
      provider: transaction.provider ?? "bachs",
      bachsPaymentMethod: transaction.bachsPaymentMethod,
      amount: transaction.amount,
      displayUsd: plan?.displayUsd,
      amountNgn: transaction.aellaAmountNgn,
      accountNumber: transaction.aellaAccountNumber,
      accountName: transaction.aellaAccountName,
      bankName: transaction.aellaBankName,
      authorizationUrl: transaction.authorizationUrl,
      reference:
        transaction.aellaAccountNumber ??
        transaction.bachsReference ??
        transaction.paystackReference,
      expiresAt: transaction.expiresAt,
      createdAt: transaction.createdAt,
      user: {
        plan: effectivePlan(user),
        proPlanExpiry: user.proPlanExpiry,
      },
    });
  },
);

export const bachsWebhook = asyncHandler(
  async (req: Request, res: Response) => {
    const rawBody = req.body as Buffer;
    const signature = req.headers["x-bachs-signature"] as string | undefined;
    const timestamp = req.headers["x-bachs-timestamp"] as string | undefined;

    if (!Buffer.isBuffer(rawBody)) {
      console.warn(
        "Bachs webhook received without raw body — check express.raw mount order",
      );
      res.status(400).send("invalid body");
      return;
    }

    if (
      !BachsService.verifyWebhookSignature(
        rawBody,
        env.BACHS_WEBHOOK_SECRET,
        timestamp,
        signature,
      )
    ) {
      console.warn("Bachs webhook signature mismatch");
      res.status(401).send("invalid signature");
      return;
    }

    let payload: {
      id?: string;
      type?: string;
      data?: {
        charge_id?: string | null;
        checkout_id?: string | null;
        reference?: string | null;
        status?: string;
        payment_method?: string;
      };
    };
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      res.status(400).send("invalid json");
      return;
    }

    if (payload.id) {
      const already = await WebhookEvent.findOne({ eventId: payload.id });
      if (already) {
        res.status(200).send("OK: duplicate");
        return;
      }
    }

    const type = payload.type;
    const data = payload.data ?? {};
    const query = bachsTransactionQuery(data);

    if (
      type === "collection.succeeded" ||
      type === "collection.failed" ||
      type === "collection.underpaid" ||
      type === "checkout.expired"
    ) {
      if (!query) {
        console.warn(`Bachs webhook ${type} missing checkout_id/reference`);
        res.status(200).send("OK: missing reference");
        return;
      }

      const transaction = await Transaction.findOne({
        ...query,
        provider: "bachs",
      });
      if (!transaction) {
        console.warn(
          `Bachs webhook ${type} for unknown checkout: ${JSON.stringify(query)}`,
        );
        res.status(200).send("OK: transaction not found");
        return;
      }

      if (typeof data.charge_id === "string" && data.charge_id) {
        transaction.bachsChargeId = data.charge_id;
      }

      if (type === "collection.succeeded") {
        if (transaction.status !== "success") {
          await applySuccessfulPayment(transaction);
          const user = await User.findById(transaction.userId);
          console.log(
            `Successfully upgraded ${user?.email ?? transaction.userId} via Bachs ${transaction.bachsCheckoutId ?? transaction.bachsReference}.`,
          );
        }
      } else if (type === "collection.underpaid") {
        console.warn(
          `Bachs checkout ${transaction.bachsCheckoutId} underpaid — not crediting`,
        );
        await transaction.save();
      } else if (transaction.status !== "success") {
        transaction.status = "failed";
        await transaction.save();
      }
    }

    if (payload.id) {
      try {
        await WebhookEvent.create({
          provider: "bachs",
          eventId: payload.id,
          type: type ?? "unknown",
        });
      } catch (error) {
        const code = (error as { code?: number }).code;
        if (code !== 11000) {
          console.warn("Failed to record Bachs webhook event:", error);
        }
      }
    }

    res.status(200).send("OK");
  },
);

export function aellaInwardsAccountNumber(data: {
  receiverAccountNumber?: string | null;
  sourceWallet?: string | null;
}): string | null {
  if (
    typeof data.receiverAccountNumber === "string" &&
    data.receiverAccountNumber.trim()
  ) {
    return data.receiverAccountNumber.trim();
  }
  return null;
}

export const aellaWebhook = asyncHandler(
  async (req: Request, res: Response) => {
    const rawBody = req.body as Buffer;
    const signature = req.headers["x-aella-signature"] as string | undefined;

    if (!Buffer.isBuffer(rawBody)) {
      console.warn(
        "Aella webhook received without raw body — check express.raw mount order",
      );
      res.status(400).send("invalid body");
      return;
    }

    if (
      !AellaService.verifyWebhookSignature(
        rawBody,
        env.AELLA_SECRET_KEY,
        signature,
      )
    ) {
      console.warn("Aella webhook signature mismatch");
      res.status(401).send("invalid signature");
      return;
    }

    let payload: {
      event?: string;
      data?: {
        id?: string | null;
        amount?: number | string | null;
        status?: string | null;
        receiverAccountNumber?: string | null;
        sourceWallet?: string | null;
      };
    };
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      res.status(400).send("invalid json");
      return;
    }

    const eventId =
      typeof payload.data?.id === "string" && payload.data.id.trim()
        ? `aella:${payload.data.id.trim()}`
        : null;
    if (eventId) {
      const already = await WebhookEvent.findOne({ eventId });
      if (already) {
        res.status(200).send("OK: duplicate");
        return;
      }
    }

    const type = payload.event;
    const data = payload.data ?? {};
    const accountNumber = aellaInwardsAccountNumber(data);

    if (type === "inwards.completed" || type === "inwards.failed") {
      if (!accountNumber) {
        console.warn(`Aella webhook ${type} missing receiverAccountNumber`);
        res.status(200).send("OK: missing account");
        return;
      }

      const transaction = await Transaction.findOne({
        aellaAccountNumber: accountNumber,
        provider: "aella",
      });
      if (!transaction) {
        console.warn(`Aella webhook ${type} for unknown account ${accountNumber}`);
        res.status(200).send("OK: transaction not found");
        return;
      }

      if (typeof data.id === "string" && data.id) {
        transaction.aellaInwardsId = data.id;
      }

      if (type === "inwards.completed") {
        if (
          !aellaAmountsMatch(transaction.aellaAmountNgn ?? 0, data.amount)
        ) {
          console.warn(
            `Aella inward ${accountNumber} amount mismatch: expected ${transaction.aellaAmountNgn}, got ${data.amount}`,
          );
        } else if (transaction.status !== "success") {
          await applySuccessfulPayment(transaction);
          const user = await User.findById(transaction.userId);
          console.log(
            `Successfully upgraded ${user?.email ?? transaction.userId} via Aella ${accountNumber}.`,
          );
        }
      } else if (transaction.status !== "success") {
        transaction.status = "failed";
        await transaction.save();
      }
    }

    if (eventId) {
      try {
        await WebhookEvent.create({
          provider: "aella",
          eventId,
          type: type ?? "unknown",
        });
      } catch (error) {
        const code = (error as { code?: number }).code;
        if (code !== 11000) {
          console.warn("Failed to record Aella webhook event:", error);
        }
      }
    }

    res.status(200).send("OK");
  },
);
