import { Router } from "express";
import {
  generateUpgradePayment,
  aellaWebhook,
  createStablecoinDeposit,
  getStablecoinDeposit,
  getFundingBalance,
} from "../controllers/payments.controller";
import { verifyToken } from "../middleware/auth.middleware";

const router: Router = Router();

// Protected route to generate payment for Pro Upgrade
router.post("/upgrade", verifyToken, generateUpgradePayment);
router.post("/deposits", verifyToken, createStablecoinDeposit);
router.get("/deposits/:id", verifyToken, getStablecoinDeposit);
router.get("/balance", verifyToken, getFundingBalance);

// Public route for Aella to send webhooks
router.post("/webhook", aellaWebhook);

export default router;
