import { Router } from "express";
import {
  getApprovedSignals,
  playSignal,
  getSignalHistory,
  getApprovedSignalsWinRate,
  invalidateApprovedCache,
  handleSignalAlert,
} from "../controllers/signals.controller";
import { getPairSignal, getUsageStats } from "../controllers/fcsapi.controller";
import { verifyToken } from "../middleware/auth.middleware";

const router: Router = Router();

router.get("/approved", verifyToken, getApprovedSignals);
router.post("/play", verifyToken, playSignal);
router.get("/history", verifyToken, getSignalHistory);
router.get("/win-rate", verifyToken, getApprovedSignalsWinRate);
router.post("/cache/invalidate", invalidateApprovedCache);
// Server-to-server webhook: admin-server posts TP1/TP2/SL/SL_WARNING events
// here; signova_server fans out emails to its own User collection. Gated by
// the SIGNALS_ALERT_SECRET shared secret, no JWT — same pattern as the
// cache invalidate endpoint above.
router.post("/alert", handleSignalAlert);

// fcsapi endpoints
router.get("/pair/:pair/signals", verifyToken, getPairSignal);
router.get("/usage", verifyToken, getUsageStats);

export default router;
