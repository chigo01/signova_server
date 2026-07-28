import { Router } from "express";
import {
  registerPushDevice,
  unregisterPushDevice,
} from "../controllers/push.controller";
import { verifyToken } from "../middleware/auth.middleware";
import { asyncHandler } from "../middleware/asyncHandler";

const router: Router = Router();

router.post("/devices", verifyToken, asyncHandler(registerPushDevice));
router.delete("/devices", verifyToken, asyncHandler(unregisterPushDevice));

export default router;
