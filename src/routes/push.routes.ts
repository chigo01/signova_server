import { Router } from "express";
import {
  handlePushBroadcast,
  registerPushDevice,
  unregisterPushDevice,
} from "../controllers/push.controller";
import { verifyToken } from "../middleware/auth.middleware";
import { asyncHandler } from "../middleware/asyncHandler";

const router: Router = Router();

router.post("/devices", verifyToken, asyncHandler(registerPushDevice));
router.delete("/devices", verifyToken, asyncHandler(unregisterPushDevice));
// Server-to-server: admin-server posts ad-hoc broadcasts here. Gated by
// SIGNALS_ALERT_SECRET (same shared secret as /signals/alert), no JWT.
router.post("/broadcast", asyncHandler(handlePushBroadcast));

export default router;
