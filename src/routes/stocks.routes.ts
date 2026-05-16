import { Router } from "express";
import { getRecommendations, getTopNews } from "../controllers/stocks.controller";
import { verifyToken } from "../middleware/auth.middleware";

const router: Router = Router();

router.get("/recommendations", verifyToken, getRecommendations);
router.get("/news", verifyToken, getTopNews);

export default router;
