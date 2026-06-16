import { Router } from "express";
import { verifyToken } from "../middleware/auth.middleware";
import {
  getReferralOverview,
  getReferralTransactions,
  getReferralLeaderboard,
} from "../controllers/referral.controller";

const router: Router = Router();

router.get("/overview", verifyToken, getReferralOverview);
router.get("/transactions", verifyToken, getReferralTransactions);
router.get("/leaderboard", verifyToken, getReferralLeaderboard);

export default router;
