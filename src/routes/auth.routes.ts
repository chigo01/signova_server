import { Router } from "express";
import {
  sendOtp,
  verifyOtp,
  googleLogin,
  logout,
  checkAuth,
} from "../controllers/auth.controller";
import { verifyToken } from "../middleware/auth.middleware";

const router = Router();

router.post("/send-otp", sendOtp);
router.post("/verify-otp", verifyOtp);
router.post("/google", googleLogin);
router.post("/logout", logout);
router.get("/check", verifyToken, checkAuth);

export default router;
