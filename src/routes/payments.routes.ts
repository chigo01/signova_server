import { Router } from "express";
import { generateUpgradePayment, aellaWebhook } from "../controllers/payments.controller";
import { verifyToken } from "../middleware/auth.middleware";

const router: Router = Router();

// Protected route to generate payment for Pro Upgrade
router.post("/upgrade", verifyToken, generateUpgradePayment);

// Public route for Aella to send webhooks
router.post("/webhook", aellaWebhook);

export default router;
