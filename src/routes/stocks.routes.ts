import { Router } from "express";
import { getRecommendations } from "../controllers/stocks.controller";
import { verifyToken } from "../middleware/auth.middleware";

const router: Router = Router();

router.get("/recommendations", verifyToken, getRecommendations);

export default router;
