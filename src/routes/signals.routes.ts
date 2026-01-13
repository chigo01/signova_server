import { Router } from "express";
import { getApprovedSignals } from "../controllers/signals.controller";
import { verifyToken } from "../middleware/auth.middleware";

const router = Router();

router.get("/approved", verifyToken, getApprovedSignals);

export default router;
