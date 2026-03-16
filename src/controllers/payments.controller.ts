import { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler";
import { AppError } from "../middleware/errorHandler";
import { AellaService } from "../services/aella.service";
import Transaction from "../models/transaction.model";
import User from "../models/user.model";

const PRO_PLAN_AMOUNT = 100; // e.g., 5000 NGN

export const generateUpgradePayment = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError(401, "Unauthorized");
  }

  const userId = req.user.userId;

  const user = await User.findById(userId);
  if (!user) {
    throw new AppError(404, "User not found");
  }

  // Generate a dynamic virtual account
  // Aella account names might have strict length/character validation.
  // We'll strip special chars and keep it under 30 chars total (including "Pro-")
  const baseName = (user.name || user.email.split("@")[0]).replace(/[^a-zA-Z0-9 ]/g, '').trim();
  const accountName = `Pro Upgrade ${baseName}`.substring(0, 30).trim();

  const amount = PRO_PLAN_AMOUNT;
  const expiryTimeInMinutes = 60;

  const aellaResponse = await AellaService.createDynamicVirtualAccount(
    accountName,
    amount,
    expiryTimeInMinutes
  );

  if (!aellaResponse.success) {
    throw new AppError(500, "Failed to create virtual wallet");
  }

  const { id, accountNumber, bankName, expiresAt } = aellaResponse.data;

  // Save the pending transaction
  await Transaction.create({
    userId,
    amount,
    status: 'pending',
    aellaVirtualWalletId: id,
    accountNumber,
    bankName,
    expiresAt,
  });

  res.status(200).json({
    message: "Virtual wallet created successfully",
    accountNumber,
    bankName,
    amount,
    expiresAt
  });
});

export const aellaWebhook = asyncHandler(async (req: Request, res: Response) => {
  const payload = req.body;

  // Best practice: Validate webhook signature if Aella provides one
  // (Currently omitted for simplicity as per Aella docs)

  if (payload.event === "inwards.completed" && payload.data.status === "Success") {
    const sourceWallet = payload.data.sourceWallet; // This is the dynamic wallet ID

    if (!sourceWallet) {
      res.status(200).send("OK: Ignoring non-virtual-wallet inward transfer");
      return;
    }

    const transaction = await Transaction.findOne({ aellaVirtualWalletId: sourceWallet });
    if (!transaction) {
      console.warn(`Webhook received for unknown wallet id: ${sourceWallet}`);
      res.status(200).send("OK: Transaction not found");
      return;
    }

    if (transaction.status !== 'success') {
      // Update transaction status
      transaction.status = 'success';
      await transaction.save();

      // Upgrade User Plan
      const user = await User.findById(transaction.userId);
      if (user) {
        user.plan = 'pro';
        // Add e.g., 30 days or reset to +30 days from now
        const expiry = new Date();
        expiry.setDate(expiry.getDate() + 30);
        user.proPlanExpiry = expiry;

        await user.save();
        console.log(`Successfully upgraded user ${user.email} to Pro.`);
      }
    }
  }

  // Always respond with 200 OK to acknowledge receipt
  res.status(200).send("OK");
});
