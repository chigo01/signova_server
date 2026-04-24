import { Router } from "express";
import {
  getTvConfig,
  getTvHistory,
  getTvQuotes,
  getTvTime,
  resolveTvSymbol,
  searchTvSymbols,
} from "../controllers/tv.controller";

const router: Router = Router();

router.get("/config", getTvConfig);
router.get("/search", searchTvSymbols);
router.get("/symbols", resolveTvSymbol);
router.get("/history", getTvHistory);
router.get("/time", getTvTime);
router.get("/quotes", getTvQuotes);

export default router;
