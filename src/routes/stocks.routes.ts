import { Router } from "express";
import {
  addPersonalWatchlistStock,
  getPersonalWatchlist,
  getRecommendations,
  getTopNews,
  removePersonalWatchlistStock,
  setActivePersonalWatchlistStocks,
} from "../controllers/stocks.controller";
import { verifyToken } from "../middleware/auth.middleware";
import { watchlistMutationLimiter } from "../middleware/rateLimit.middleware";

const router: Router = Router();

// Public market-data endpoints — global recommendations/news (no user-specific
// data), so guests can browse the stocks teaser without authenticating. The
// stock *detail* payoff is still gated client-side in the webapp.
router.get("/recommendations", getRecommendations);
router.get("/news", getTopNews);
router.get("/watchlist", verifyToken, getPersonalWatchlist);
router.post(
  "/watchlist",
  verifyToken,
  watchlistMutationLimiter,
  addPersonalWatchlistStock,
);
router.put(
  "/watchlist/active",
  verifyToken,
  watchlistMutationLimiter,
  setActivePersonalWatchlistStocks,
);
router.delete(
  "/watchlist/:symbol",
  verifyToken,
  watchlistMutationLimiter,
  removePersonalWatchlistStock,
);

export default router;
