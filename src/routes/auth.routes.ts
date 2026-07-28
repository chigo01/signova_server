import { Router } from "express";
import {
  sendOtp,
  verifyOtp,
  googleLogin,
  appleLogin,
  logout,
  checkAuth,
  updateProfile,
} from "../controllers/auth.controller";
import { verifyToken } from "../middleware/auth.middleware";
import {
  otpRequestLimiter,
  otpVerifyLimiter,
  socialAuthLimiter,
} from "../middleware/rateLimit.middleware";

const router: Router = Router();

router.post("/send-otp", otpRequestLimiter, sendOtp);
router.post("/verify-otp", otpVerifyLimiter, verifyOtp);
router.post("/google", socialAuthLimiter, googleLogin);
router.post("/apple", socialAuthLimiter, appleLogin);
router.post("/logout", logout);
router.get("/check", verifyToken, checkAuth);
router.patch("/profile", verifyToken, updateProfile);

export default router;
