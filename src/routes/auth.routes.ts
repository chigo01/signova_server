import { Router } from "express";
import {
  sendOtp,
  verifyOtp,
  googleLogin,
  appleLogin,
  logout,
  checkAuth,
  updateProfile,
  requestAccountDeletion,
  revokeAccountDeletion,
} from "../controllers/auth.controller";
import { verifyToken } from "../middleware/auth.middleware";
import {
  accountDeletionLimiter,
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
// verifyToken runs before the limiter so it can key on the user id rather than
// a shared IP bucket.
router.post(
  "/account/delete",
  verifyToken,
  accountDeletionLimiter,
  requestAccountDeletion
);
router.post(
  "/account/delete/revoke",
  verifyToken,
  accountDeletionLimiter,
  revokeAccountDeletion
);

export default router;
