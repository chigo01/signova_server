import { Router } from "express";
import { getYoutubeVideos } from "../controllers/youtube.controller";

const router: Router = Router();

// Public endpoint - get active videos for webapp display
router.get("/", getYoutubeVideos);

export default router;
