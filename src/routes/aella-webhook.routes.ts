import { Router, raw } from "express";
import { aellaWebhook } from "../controllers/payments.controller";

const router: Router = Router();

router.post(
  "/",
  raw({ type: "application/json", limit: "1mb" }),
  aellaWebhook,
);

export default router;
