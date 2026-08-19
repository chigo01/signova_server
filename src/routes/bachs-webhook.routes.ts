import { Router, raw } from "express";
import { bachsWebhook } from "../controllers/payments.controller";

const router: Router = Router();

router.post(
  "/",
  raw({ type: "application/json", limit: "1mb" }),
  bachsWebhook,
);

export default router;
