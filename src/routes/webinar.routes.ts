import { Router } from "express";
import {
  getWebinarRaffle,
  loginRaffleAdmin,
  registerWebinarAttendee,
  runWebinarRaffle,
} from "../controllers/webinar.controller";
import {
  raffleAdminLoginLimiter,
  webinarRegistrationLimiter,
} from "../middleware/rateLimit.middleware";
import {
  requireWebinarService,
  verifyRaffleAdmin,
} from "../middleware/webinar.middleware";

const router: Router = Router();

router.use(requireWebinarService);
router.post("/registrations", webinarRegistrationLimiter, registerWebinarAttendee);
router.post("/admin/login", raffleAdminLoginLimiter, loginRaffleAdmin);
router.get("/admin/raffle", verifyRaffleAdmin, getWebinarRaffle);
router.post("/admin/raffle/draw", verifyRaffleAdmin, runWebinarRaffle);

export default router;
