import { Router, raw } from "express";
import { revenueCatWebhook } from "../controllers/revenuecat.controller";

const router: Router = Router();

router.post(
  "/",
  raw({ type: "application/json", limit: "1mb" }),
  revenueCatWebhook,
);

export default router;
