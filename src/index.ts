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
import paymentsRoutes from "./routes/payments.routes";
import paystackWebhookRoutes from "./routes/paystack-webhook.routes";
import tvRoutes from "./routes/tv.routes";
import analysisRoutes from "./routes/analysis.routes";
import journalRoutes from "./routes/journal.routes";
import chartPresetRoutes from "./routes/chartPreset.routes";
import referralRoutes from "./routes/referral.routes";
import adminRoutes from "./routes/admin.routes";
import { DextopusDepositSyncService } from "./services/dextopusDepositSync.service";
import { errorHandler } from "./middleware/errorHandler";

const app = express();

// Connect Database
connectDB();

// Middleware
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser clients (no Origin header)
      if (!origin) return callback(null, true);

      if (env.FRONTEND_URLS.includes(origin)) return callback(null, true);

      return callback(new Error(`CORS blocked origin: ${origin}`));
    },
    credentials: true,
  })
);
app.use(helmet());
app.use(morgan("dev"));
app.use(cookieParser());

// Paystack webhook needs raw bytes for HMAC verification — mount before express.json()
app.use("/payments/webhook", paystackWebhookRoutes);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/auth", authRoutes);
app.use("/signals", signalsRoutes);
app.use("/youtube", youtubeRoutes);
app.use("/stocks", stocksRoutes);
app.use("/payments", paymentsRoutes);
app.use("/tv", tvRoutes);
app.use("/analysis", analysisRoutes);
app.use("/journal", journalRoutes);
app.use("/chart-presets", chartPresetRoutes);
app.use("/referrals", referralRoutes);
app.use("/admin", adminRoutes);

app.get("/", (_req: Request, res: Response) => {
  res.json({ message: "Welcome to the Signova API!" });
});

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Error handling middleware (must be last)
app.use(errorHandler);

DextopusDepositSyncService.start();

// Start server
app.listen(env.PORT, () => {
  console.log(`🚀 Server running at http://localhost:${env.PORT}`);
});
