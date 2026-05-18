import { Router, raw } from "express";
import { paystackWebhook } from "../controllers/payments.controller";

const router: Router = Router();

router.post(
  "/",
  raw({ type: "application/json", limit: "1mb" }),
  paystackWebhook,
);

export default router;
