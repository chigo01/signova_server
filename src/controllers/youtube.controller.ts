import { Request, Response } from "express";
import YoutubeLink, {
  extractYoutubeVideoId,
} from "../models/youtubeLink.model";

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

// Get all YouTube videos (admin endpoint)
export const getAllYoutubeVideos = async (_req: Request, res: Response) => {
  try {
    const videos = await YoutubeLink.find()
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

// Add a new YouTube video
export const addYoutubeVideo = async (req: Request, res: Response) => {
  try {
    const { title, youtubeUrl, description } = req.body;

    if (!title || !youtubeUrl) {
      return res.status(400).json({
        success: false,
        error: "Title and YouTube URL are required",
      });
    }

    const videoId = extractYoutubeVideoId(youtubeUrl);
    if (!videoId) {
      return res.status(400).json({
        success: false,
        error: "Invalid YouTube URL",
      });
    }

    // Check if video already exists
    const existingVideo = await YoutubeLink.findOne({ videoId });
    if (existingVideo) {
      return res.status(400).json({
        success: false,
        error: "This video has already been added",
      });
    }

    // Get the highest order number
    const lastVideo = await YoutubeLink.findOne().sort({ order: -1 });
    const order = lastVideo ? lastVideo.order + 1 : 0;

    const newVideo = await YoutubeLink.create({
      title,
      youtubeUrl,
      videoId,
      description,
      order,
    });

    return res.status(201).json({
      success: true,
      video: newVideo,
    });
  } catch (error) {
    console.error("Error adding YouTube video:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to add video",
    });
  }
};

// Update a YouTube video
export const updateYoutubeVideo = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, youtubeUrl, description, isActive, order } = req.body;

    const video = await YoutubeLink.findById(id);
    if (!video) {
      return res.status(404).json({
        success: false,
        error: "Video not found",
      });
    }

    // If URL is being updated, extract new video ID
    if (youtubeUrl && youtubeUrl !== video.youtubeUrl) {
      const newVideoId = extractYoutubeVideoId(youtubeUrl);
      if (!newVideoId) {
        return res.status(400).json({
          success: false,
          error: "Invalid YouTube URL",
        });
      }
      video.youtubeUrl = youtubeUrl;
      video.videoId = newVideoId;
    }

    if (title !== undefined) video.title = title;
    if (description !== undefined) video.description = description;
    if (isActive !== undefined) video.isActive = isActive;
    if (order !== undefined) video.order = order;

    await video.save();

    return res.json({
      success: true,
      video,
    });
  } catch (error) {
    console.error("Error updating YouTube video:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to update video",
    });
  }
};

// Delete a YouTube video
export const deleteYoutubeVideo = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const video = await YoutubeLink.findByIdAndDelete(id);
    if (!video) {
      return res.status(404).json({
        success: false,
        error: "Video not found",
      });
    }

    return res.json({
      success: true,
      message: "Video deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting YouTube video:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to delete video",
    });
  }
};
