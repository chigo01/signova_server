import Deposit, { DepositStatus, IDeposit } from "../models/deposit.model";
import User from "../models/user.model";
import { env } from "../config/env";
import { DextopusDepositStatusResponse, DextopusService } from "./dextopus.service";
import { PRO_PLAN_AMOUNT_USD_MICRO, SubscriptionService } from "./subscription.service";
import { ReferralService } from "./referral.service";

function normalizeStatus(input?: string): string {
  return String(input || "").trim().toLowerCase();
}

function extractAtomicAmount(
  status: DextopusDepositStatusResponse,
  deposit: IDeposit
): string | undefined {
  const raw = status.raw || {};
  const candidates = [
    raw.amountOut,
    raw.destinationAmountOut,
    raw.receivedAmountOut,
    raw.amountReceived,
    deposit.quotedAmountOut,
  ];

  const match = candidates.find(
    (value): value is string =>
      typeof value === "string" && value.trim() !== "" && /^\d+$/.test(value.trim())
  );

  return match?.trim();
}

function mapDepositStatus(
  status: DextopusDepositStatusResponse,
  deposit: IDeposit
): DepositStatus {
  const providerStatus = normalizeStatus(status.status);
  const executionStatus = normalizeStatus(status.executionStatus);
  const combined = `${providerStatus} ${executionStatus}`.trim();

  if (
    combined.includes("expired") ||
    combined.includes("timeout")
  ) {
    return "expired";
  }

  if (
    combined.includes("fail") ||
    combined.includes("error") ||
    combined.includes("revert") ||
    combined.includes("cancel") ||
    combined.includes("refund")
  ) {
    return "failed";
  }

  if (
    combined.includes("success") ||
    combined.includes("complete") ||
    combined.includes("settl") ||
    combined.includes("deliver") ||
    combined.includes("finish")
  ) {
    return "success";
  }

  if ((status.originTransactionHashes || []).length > 0) {
    return "processing";
  }

  if (deposit.expiresAt && deposit.expiresAt.getTime() < Date.now()) {
    return "expired";
  }

  if (providerStatus.includes("wait") || providerStatus.includes("pending")) {
    return "awaiting_funds";
  }

  return deposit.status === "pending" ? "awaiting_funds" : deposit.status;
}

export class DextopusDepositSyncService {
  private static timer: NodeJS.Timeout | null = null;
  private static isSyncing = false;

  static start(): void {
    if (this.timer || !DextopusService.isDepositConfigured()) {
      return;
    }

    const intervalMs = Math.max(env.DEXTOPUS_STATUS_POLL_INTERVAL_MS, 5000);
    this.timer = setInterval(() => {
      void this.syncPendingDeposits();
    }, intervalMs);
    this.timer.unref?.();

    void this.syncPendingDeposits();
  }

  static async syncPendingDeposits(limit: number = 25): Promise<void> {
    if (this.isSyncing) {
      return;
    }

    this.isSyncing = true;
    try {
      const deposits = await Deposit.find({
        provider: "dextopus",
        status: { $in: ["pending", "awaiting_funds", "processing"] },
      })
        .sort({ updatedAt: 1 })
        .limit(limit);

      for (const deposit of deposits) {
        try {
          await this.syncDeposit(deposit);
        } catch (error) {
          console.error(
            `Failed to sync Dextopus deposit ${deposit.depositRequestId}:`,
            error
          );
        }
      }
    } finally {
      this.isSyncing = false;
    }
  }

  static async syncDeposit(deposit: IDeposit): Promise<IDeposit> {
    const status = await DextopusService.getDepositStatus({
      depositRequestId: deposit.depositRequestId,
    });

    const nextStatus = mapDepositStatus(status, deposit);
    const settledAmountOut = extractAtomicAmount(status, deposit);

    const syncedDeposit = await Deposit.findByIdAndUpdate(
      deposit._id,
      {
        $set: {
          status: nextStatus,
          providerStatus: status.status,
          executionStatus: status.executionStatus,
          settledAmountOut: settledAmountOut || deposit.settledAmountOut,
          originTransactionHashes: status.originTransactionHashes || [],
          destinationTransactionHashes: status.destinationTransactionHashes || [],
          providerPayload: status.raw || {},
          lastSyncedAt: new Date(),
        },
      },
      { new: true }
    );

    if (!syncedDeposit) {
      throw new Error("Deposit not found after sync update");
    }

    const shouldFinalize =
      nextStatus === "success" &&
      (!syncedDeposit.creditApplied || !syncedDeposit.subscriptionApplied) &&
      (syncedDeposit.destinationTransactionHashes.length > 0 ||
        normalizeStatus(status.executionStatus).includes("success") ||
        normalizeStatus(status.executionStatus).includes("complete"));

    if (!shouldFinalize) {
      return syncedDeposit;
    }

    const atomicAmount = settledAmountOut;
    if (!atomicAmount && syncedDeposit.type === "account_funding") {
      return syncedDeposit;
    }

    let finalizedDeposit = syncedDeposit;

    if (
      syncedDeposit.type === "account_funding" &&
      atomicAmount &&
      !syncedDeposit.creditApplied
    ) {
      const creditedDeposit = await Deposit.findOneAndUpdate(
        { _id: syncedDeposit._id, creditApplied: false },
        {
          $set: {
            creditApplied: true,
            creditedAt: new Date(),
            settledAmountOut: atomicAmount,
            status: "success",
          },
        },
        { new: true }
      );

      if (creditedDeposit) {
        await User.findByIdAndUpdate(creditedDeposit.userId, {
          $inc: { balanceUsdMicro: Number(atomicAmount) },
        });
        finalizedDeposit = creditedDeposit;
      }
    }

    if (
      syncedDeposit.type === "plan_upgrade" &&
      !syncedDeposit.subscriptionApplied &&
      atomicAmount &&
      Number(atomicAmount) >=
        Number(syncedDeposit.requiredAmountOut || PRO_PLAN_AMOUNT_USD_MICRO)
    ) {
      const upgradedDeposit = await Deposit.findOneAndUpdate(
        { _id: syncedDeposit._id, subscriptionApplied: false },
        {
          $set: {
            subscriptionApplied: true,
            subscriptionAppliedAt: new Date(),
            settledAmountOut: atomicAmount,
            status: "success",
          },
        },
        { new: true }
      );

      if (upgradedDeposit) {
        await SubscriptionService.activateOrExtendPro(String(upgradedDeposit.userId));
        // Credit the referrer (if any) — 1 SIGcoin on first subscription.
        await ReferralService.creditSubscribedReferral(
          String(upgradedDeposit.userId),
        );
        finalizedDeposit = upgradedDeposit;
      }
    }

    return finalizedDeposit;
  }
}
