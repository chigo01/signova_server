import { Request, Response } from "express";
import mongoose from "mongoose";
import Deposit from "../models/deposit.model";
import Transaction from "../models/transaction.model";
import User from "../models/user.model";
import { asyncHandler } from "../middleware/asyncHandler";
import { AppError } from "../middleware/errorHandler";
import { AellaService } from "../services/aella.service";
import { DextopusDepositSyncService } from "../services/dextopusDepositSync.service";
import { DextopusService } from "../services/dextopus.service";
import {
  PRO_PLAN_AMOUNT_USD,
  PRO_PLAN_AMOUNT_USD_MICRO,
  SubscriptionService,
} from "../services/subscription.service";
import { PLANS, isPlanId } from "../config/plans";

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
    const baseName = (user.name || user.email.split("@")[0])
      .replace(/[^a-zA-Z0-9 ]/g, "")
      .trim();
    const planLabel = planId === "business" ? "Business" : "Pro";
    const accountName = `${planLabel} Upgrade ${baseName}`
      .substring(0, 30)
      .trim();

    const amount = plan.priceNgn;
    const expiryTimeInMinutes = 60;

    const aellaResponse = await AellaService.createDynamicVirtualAccount(
      accountName,
      amount,
      expiryTimeInMinutes,
    );

    if (!aellaResponse.success) {
      throw new AppError(500, "Failed to create virtual wallet");
    }

    const { id, accountNumber, bankName, expiresAt } = aellaResponse.data;

    const transaction = await Transaction.create({
      userId,
      amount,
      planId,
      monthsCount: plan.months,
      status: "pending",
      aellaVirtualWalletId: id,
      accountNumber,
      bankName,
      expiresAt,
    });

    res.status(200).json({
      message: "Virtual wallet created successfully",
      transactionId: String(transaction._id),
      planId,
      monthsCount: plan.months,
      accountNumber,
      bankName,
      amount,
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
        plan: user.plan,
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
      plan: user.plan,
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
      accountNumber: transaction.accountNumber,
      bankName: transaction.bankName,
      expiresAt: transaction.expiresAt,
      createdAt: transaction.createdAt,
      user: {
        plan: user.plan,
        proPlanExpiry: user.proPlanExpiry,
      },
    });
  },
);

export const aellaWebhook = asyncHandler(
  async (req: Request, res: Response) => {
    const payload = req.body;

    if (
      payload.event === "inwards.completed" &&
      payload.data.status === "Success"
    ) {
      const sourceWallet = payload.data.sourceWallet;

      if (!sourceWallet) {
        res.status(200).send("OK: Ignoring non-virtual-wallet inward transfer");
        return;
      }

      const transaction = await Transaction.findOne({
        aellaVirtualWalletId: sourceWallet,
      });
      if (!transaction) {
        console.warn(`Webhook received for unknown wallet id: ${sourceWallet}`);
        res.status(200).send("OK: Transaction not found");
        return;
      }

      if (transaction.status !== "success") {
        transaction.status = "success";
        await transaction.save();

        const user = await User.findById(transaction.userId);
        if (user) {
          const months =
            typeof transaction.monthsCount === "number" &&
            transaction.monthsCount > 0
              ? transaction.monthsCount
              : 1;
          await SubscriptionService.activateOrExtendPro(
            String(user._id),
            months,
          );
          console.log(
            `Successfully upgraded user ${user.email} to Pro for ${months} month(s).`,
          );
        }
      }
    }

    res.status(200).send("OK");
  },
);
