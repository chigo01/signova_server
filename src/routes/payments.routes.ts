import { Router } from "express";
import {
  generateUpgradePayment,
  createStablecoinDeposit,
  getStablecoinDeposit,
  getFundingBalance,
  getTransactionStatus,
} from "../controllers/payments.controller";
import { verifyToken } from "../middleware/auth.middleware";

const router: Router = Router();

router.post("/upgrade", verifyToken, generateUpgradePayment);
router.get("/transactions/:id", verifyToken, getTransactionStatus);
router.post("/deposits", verifyToken, createStablecoinDeposit);
router.get("/deposits/:id", verifyToken, getStablecoinDeposit);
router.get("/balance", verifyToken, getFundingBalance);

export default router;
