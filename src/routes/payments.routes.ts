import { Router } from "express";
import {
  generateUpgradePayment,
  generateBachsUpgradePayment,
  listPaymentMethods,
  createStablecoinDeposit,
  getStablecoinDeposit,
  listDepositSources,
  previewStablecoinDeposit,
  validateDepositRefundAddress,
  submitStablecoinDepositHash,
  getFundingBalance,
  getTransactionStatus,
} from "../controllers/payments.controller";
import { verifyToken } from "../middleware/auth.middleware";

const router: Router = Router();

router.get("/methods", verifyToken, listPaymentMethods);
router.post("/upgrade", verifyToken, generateUpgradePayment);
router.post("/upgrade/bachs", verifyToken, generateBachsUpgradePayment);
router.get("/transactions/:id", verifyToken, getTransactionStatus);
router.get("/deposits/sources", verifyToken, listDepositSources);
router.post("/deposits/preview", verifyToken, previewStablecoinDeposit);
router.post(
  "/deposits/validate-address",
  verifyToken,
  validateDepositRefundAddress,
);
router.post("/deposits", verifyToken, createStablecoinDeposit);
router.post("/deposits/:id/submit", verifyToken, submitStablecoinDepositHash);
router.get("/deposits/:id", verifyToken, getStablecoinDeposit);
router.get("/balance", verifyToken, getFundingBalance);

export default router;
