import { Router } from "express";
import { verifyToken } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/admin.middleware";
import {
  listUsers,
  getUser,
  setUserRate,
  recordPayout,
  getPayouts,
  getLeaderboard,
  getStats,
  getPaymentSettings,
  updatePaymentSettings,
} from "../controllers/admin.controller";

const router: Router = Router();

// Every admin route requires a valid token AND an allowlisted admin email.
router.use(verifyToken, requireAdmin);

router.get("/stats", getStats);
router.get("/payment-settings", getPaymentSettings);
router.patch("/payment-settings", updatePaymentSettings);
router.get("/leaderboard", getLeaderboard);
router.get("/users", listUsers);
router.get("/users/:id", getUser);
router.patch("/users/:id/rate", setUserRate);
router.get("/users/:id/payouts", getPayouts);
router.post("/users/:id/payouts", recordPayout);

export default router;
