import { Request, Response } from "express";
import YoutubeLink from "../models/YoutubeLink";

// Get all active YouTube videos (public endpoint for webapp)
export const getYoutubeVideos = async (_req: Request, res: Response) => {
  try {
    const videos = await YoutubeLink.find({ isActive: true })
      .sort({ order: 1, createdAt: -1 })
      .lean();

    return res.json({
      success: true,
      videos,
    });
  } catch (error) {
    console.error("Error fetching YouTube videos:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch videos",
    });
  }
};
