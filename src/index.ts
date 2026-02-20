import dotenv from "dotenv";
dotenv.config();

import express, { Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import connectDB from "./config/db";
import { env } from "./config/env";
import authRoutes from "./routes/auth.routes";
import signalsRoutes from "./routes/signals.routes";
import youtubeRoutes from "./routes/youtube.routes";
import stocksRoutes from "./routes/stocks.routes";
import { errorHandler } from "./middleware/errorHandler";

const app = express();

// Connect Database
connectDB();

// Middleware
app.use(
  cors({
    origin: env.FRONTEND_URL,
    credentials: true,
  })
);
app.use(helmet());
app.use(morgan("dev"));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/auth", authRoutes);
app.use("/signals", signalsRoutes);
app.use("/youtube", youtubeRoutes);
app.use("/stocks", stocksRoutes);

app.get("/", (_req: Request, res: Response) => {
  res.json({ message: "Welcome to the Signova API!" });
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Error handling middleware (must be last)
app.use(errorHandler);

// Start server
app.listen(env.PORT, () => {
  console.log(`🚀 Server running at http://localhost:${env.PORT}`);
});
