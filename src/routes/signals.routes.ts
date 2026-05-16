import { Router } from "express";
import {
  getApprovedSignals,
  playSignal,
  getSignalHistory,
  getApprovedSignalsWinRate,
  invalidateApprovedCache,
} from "../controllers/signals.controller";
import { getPairSignal, getUsageStats } from "../controllers/fcsapi.controller";
import { verifyToken } from "../middleware/auth.middleware";

const router: Router = Router();

router.get("/approved", verifyToken, getApprovedSignals);
router.post("/play", verifyToken, playSignal);
router.get("/history", verifyToken, getSignalHistory);
router.get("/win-rate", verifyToken, getApprovedSignalsWinRate);
router.post("/cache/invalidate", invalidateApprovedCache);

// fcsapi endpoints
router.get("/pair/:pair/signals", verifyToken, getPairSignal);
router.get("/usage", verifyToken, getUsageStats);

export default router;
