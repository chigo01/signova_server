import { Router } from "express";
import {
  getYoutubeVideos,
  getAllYoutubeVideos,
  addYoutubeVideo,
  updateYoutubeVideo,
  deleteYoutubeVideo,
} from "../controllers/youtube.controller";
import { verifyToken } from "../middleware/auth.middleware";

const router = Router();

// Public endpoint - get active videos for webapp display
router.get("/", verifyToken, getYoutubeVideos);

// Admin endpoints
router.get("/all", verifyToken, getAllYoutubeVideos);
router.post("/", verifyToken, addYoutubeVideo);
router.put("/:id", verifyToken, updateYoutubeVideo);
router.delete("/:id", verifyToken, deleteYoutubeVideo);

export default router;
