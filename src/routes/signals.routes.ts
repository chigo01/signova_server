import { Router } from "express";
import {
  getApprovedSignals,
  playSignal,
  getSignalHistory,
} from "../controllers/signals.controller";
import { verifyToken } from "../middleware/auth.middleware";

const router = Router();

router.get("/approved", verifyToken, getApprovedSignals);
router.post("/play", verifyToken, playSignal);
router.get("/history", verifyToken, getSignalHistory);

export default router;
