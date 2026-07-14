import { Request, Response } from "express";
import crypto from "crypto";
import mongoose from "mongoose";
import Deposit from "../models/deposit.model";
import Transaction, { ITransaction } from "../models/transaction.model";
import User from "../models/user.model";
import { asyncHandler } from "../middleware/asyncHandler";
import { effectivePlan } from "../services/planEntitlement.service";
import { AppError } from "../middleware/errorHandler";
import { PaystackService } from "../services/paystack.service";
import { DextopusDepositSyncService } from "../services/dextopusDepositSync.service";
import { DextopusService } from "../services/dextopus.service";
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
  // the webhook, the client-driven status poll, and Paystack webhook retries —
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

function isDigitsOnly(value: string): boolean {
  return /^\d+$/.test(value);
}

function formatUsdMicro(amount: number): string {
  return (amount / 1_000_000).toFixed(6).replace(/\.?0+$/, "");
}

export const generateUpgradePayment = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);

    const { planId } = req.body ?? {};
    if (!isPlanId(planId)) {
      throw new AppError(
        400,
        "planId is required and must be 'pro' or 'business'",
      );
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new AppError(404, "User not found");
    }

    const plan = PLANS[planId];
    const reference = `signova_${planId}_${userId}_${crypto
      .randomBytes(6)
      .toString("hex")}`;
    const callbackUrl =
      env.PAYSTACK_CALLBACK_URL ??
      `${env.FRONTEND_URL.replace(/\/$/, "")}/dashboard/settings/pricing`;

    const paystack = await PaystackService.initializeTransaction({
      email: user.email,
      amountNgn: plan.priceNgn,
      reference,
      callbackUrl,
      metadata: {
        userId: String(user._id),
        planId,
        monthsCount: plan.months,
      },
    });

    const expiresAt = new Date(Date.now() + PAYMENT_EXPIRY_MS);

    const transaction = await Transaction.create({
      userId,
      amount: plan.priceNgn,
      planId,
      monthsCount: plan.months,
      status: "pending",
      paystackReference: paystack.reference,
      authorizationUrl: paystack.authorizationUrl,
      expiresAt,
    });

    res.status(200).json({
      message: "Payment initialized",
      transactionId: String(transaction._id),
      planId,
      monthsCount: plan.months,
      authorizationUrl: paystack.authorizationUrl,
      reference: paystack.reference,
      amount: plan.priceNgn,
      displayUsd: plan.displayUsd,
      expiresAt,
    });
  },
);

export const createStablecoinDeposit = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);

    if (!DextopusService.isDepositConfigured()) {
      throw new AppError(
        500,
        "Stablecoin funding is not configured on the server",
      );
    }

    const {
      originChainId,
      originAsset,
      amount,
      refundTo,
      slippageBps,
      dry,
      type,
    } = req.body;

    if (
      typeof originChainId !== "number" ||
      !originAsset ||
      typeof originAsset !== "string" ||
      !amount ||
      typeof amount !== "string" ||
      !isDigitsOnly(amount) ||
      !refundTo ||
      typeof refundTo !== "string"
    ) {
      throw new AppError(
        400,
        "originChainId, originAsset, amount, and refundTo are required",
      );
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new AppError(404, "User not found");
    }

    const depositType = "plan_upgrade";
    const destination = DextopusService.getConfiguredDestination();
    const partnerFees = DextopusService.getPartnerFees();
    const quote = await DextopusService.createDepositRequest({
      originChainId,
      destinationChainId: destination.destinationChainId,
      originAsset,
      destinationAsset: destination.destinationAsset,
      amount,
      recipient: destination.recipient,
      refundTo,
      user: userId,
      slippageBps:
        typeof slippageBps === "number" &&
        slippageBps >= 0 &&
        slippageBps <= 10000
          ? slippageBps
          : 300,
      dry: Boolean(dry),
      partnerFees,
    });

    if (!quote.success || !quote.depositRequestId || !quote.depositAddress) {
      throw new AppError(502, "Failed to create Dextopus deposit request");
    }

    if (
      depositType === "plan_upgrade" &&
      typeof quote.minAmountOut === "string" &&
      isDigitsOnly(quote.minAmountOut) &&
      Number(quote.minAmountOut) < PRO_PLAN_AMOUNT_USD_MICRO
    ) {
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
      type: depositType,
      status: "awaiting_funds",
      providerStatus: quote.status,
      originChainId,
      destinationChainId: destination.destinationChainId,
      originAsset,
      destinationAsset: destination.destinationAsset,
      amountIn: amount,
      quotedAmountOut: quote.amountOut,
      minAmountOut: quote.minAmountOut,
      depositAddress: quote.depositAddress,
      depositRequestId: quote.depositRequestId,
      upstreamRequestId: quote.upstreamRequestId,
      upstreamQuoteId: quote.upstreamQuoteId,
      recipient: destination.recipient,
      refundTo,
      userWalletAddress: refundTo,
      requiredAmountOut:
        depositType === "plan_upgrade"
          ? String(PRO_PLAN_AMOUNT_USD_MICRO)
          : undefined,
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
        amountIn: deposit.amountIn,
        quotedAmountOut: deposit.quotedAmountOut,
        depositAddress: deposit.depositAddress,
        depositRequestId: deposit.depositRequestId,
        expiresAt: deposit.expiresAt,
        requiredAmountOut: deposit.requiredAmountOut,
        destination: {
          chainId: deposit.destinationChainId,
          asset: deposit.destinationAsset,
          recipient: deposit.recipient,
        },
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

    res.status(200).json({
      message: "Deposit retrieved successfully",
      deposit: {
        id: syncedDeposit._id,
        type: syncedDeposit.type,
        status: syncedDeposit.status,
        providerStatus: syncedDeposit.providerStatus,
        executionStatus: syncedDeposit.executionStatus,
        amountIn: syncedDeposit.amountIn,
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

export const getFundingBalance = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    const user = await User.findById(userId);

    if (!user) {
      throw new AppError(404, "User not found");
    }

    res.status(200).json({
      plan: effectivePlan(user),
      proPlanExpiry: user.proPlanExpiry,
      balanceUsdMicro: user.balanceUsdMicro,
      balanceUsd: formatUsdMicro(user.balanceUsdMicro),
    });
  },
);

export const getTransactionStatus = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = ensureAuthenticatedUser(req);
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new AppError(400, "Invalid transaction id");
    }

    const transaction = await Transaction.findOne({ _id: id, userId });
    if (!transaction) {
      throw new AppError(404, "Transaction not found");
    }

    if (
      transaction.status === "pending" &&
      transaction.expiresAt.getTime() > Date.now()
    ) {
      try {
        const verified = await PaystackService.verifyTransaction(
          transaction.paystackReference,
        );
        if (verified.status === "success") {
          await applySuccessfulPayment(transaction);
        } else if (verified.status === "failed" || verified.status === "reversed") {
          transaction.status = "failed";
          await transaction.save();
        }
        // "abandoned", "ongoing", "pending" → keep transaction pending; webhook
        // or a later poll (after user pays) or expiresAt timeout will resolve it.
      } catch (err) {
        console.warn(
          `Paystack verify fallback failed for ${transaction.paystackReference}:`,
          (err as Error).message,
        );
      }
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new AppError(404, "User not found");
    }

    const plan = PLANS[transaction.planId];

    res.status(200).json({
      id: String(transaction._id),
      status: transaction.status,
      planId: transaction.planId,
      monthsCount: transaction.monthsCount,
      amount: transaction.amount,
      displayUsd: plan?.displayUsd,
      authorizationUrl: transaction.authorizationUrl,
      reference: transaction.paystackReference,
      expiresAt: transaction.expiresAt,
      createdAt: transaction.createdAt,
      user: {
        plan: effectivePlan(user),
        proPlanExpiry: user.proPlanExpiry,
      },
    });
  },
);

export const paystackWebhook = asyncHandler(
  async (req: Request, res: Response) => {
    const rawBody = req.body as Buffer;
    const signature = req.headers["x-paystack-signature"] as string | undefined;

    if (!Buffer.isBuffer(rawBody)) {
      console.warn(
        "Paystack webhook received without raw body — check express.raw mount order",
      );
      res.status(400).send("invalid body");
      return;
    }

    if (!PaystackService.verifyWebhookSignature(rawBody, signature)) {
      console.warn("Paystack webhook signature mismatch");
      res.status(401).send("invalid signature");
      return;
    }

    let payload: { event?: string; data?: { reference?: string } };
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      res.status(400).send("invalid json");
      return;
    }

    if (payload.event === "charge.success") {
      const reference = payload.data?.reference;
      if (!reference) {
        res.status(200).send("OK: missing reference");
        return;
      }
      const transaction = await Transaction.findOne({
        paystackReference: reference,
      });
      if (!transaction) {
        console.warn(`Webhook received for unknown reference: ${reference}`);
        res.status(200).send("OK: transaction not found");
        return;
      }
      if (transaction.status !== "success") {
        await applySuccessfulPayment(transaction);
        const user = await User.findById(transaction.userId);
        console.log(
          `Successfully upgraded ${user?.email ?? transaction.userId} via Paystack reference ${reference}.`,
        );
      }
    }

    res.status(200).send("OK");
  },
);
