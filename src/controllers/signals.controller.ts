import { Request, Response } from "express";

const ADMIN_SERVER_URL =
  process.env.ADMIN_SERVER_URL || "http://localhost:8000";

export const getApprovedSignals = async (_req: Request, res: Response) => {
  try {
    const response = await fetch(`${ADMIN_SERVER_URL}/approved-signals`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Admin server error:", errorText);
      res.status(response.status).json({
        message: "Failed to fetch signals from admin server",
        error: errorText,
      });
      return;
    }

    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    console.error("Error fetching top 5 refined signals:", error);
    res.status(500).json({
      message: "Internal server error",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
