import { Router } from "express";
import { getRecommendations, getTopNews } from "../controllers/stocks.controller";

const router: Router = Router();

// Public market-data endpoints — global recommendations/news (no user-specific
// data), so guests can browse the stocks teaser without authenticating. The
// stock *detail* payoff is still gated client-side in the webapp.
router.get("/recommendations", getRecommendations);
router.get("/news", getTopNews);

export default router;
