import { Router } from "express";
import { getPairAnalysis } from "../controllers/analysis.controller";

const router: Router = Router();

router.get("/pairs/:symbol", getPairAnalysis);

export default router;
