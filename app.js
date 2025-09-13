import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";
import { startAbandonedCron } from "./utils/scheduler.js";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Security middleware
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

// Body parsing
app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: true }));

// ✅ CORS setup
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    const o = origin.replace(/\/+$/, "");
    if (allowedOrigins.includes(o)) return cb(null, true);
    // allow vercel previews
    if (/\.vercel\.app$/.test(new URL(origin).hostname)) return cb(null, true);
    return cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));

app.use(morgan("dev"));

// Static files
app.use(
  "/public",
  (req, res, next) => {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  },
  express.static(path.join(__dirname, "public"))
);

app.get("/api/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));
// Routes
import bookRoutes from "./routes/booksroute.js";
import orderRoutes from "./routes/ordersroute.js";
import paymentRoutes from "./routes/paymentsroute.js";
import uploadRoutes from "./routes/uploadsroute.js";
import authRoutes from "./routes/authroute.js";
import settingsRoutes from "./routes/settingsroute.js";
import shiprocketRoutes from "./routes/shiprocketroute.js";
import shiprocketProfileRoutes from "./routes/shiprocketprofileroute.js";
import shipmentsRoutes from "./routes/shipmentsroute.js";
import customerRoutes from "./routes/customerRoutes.js";
import emailTemplateRoutes from "./routes/emailTemplateRoutes.js";
import mailSenderRoutes from "./routes/mailSenderRoutes.js";

app.use("/api/admin/mail-senders", mailSenderRoutes);
app.use("/api/admin/email-templates", emailTemplateRoutes);
app.use("/api/auth/customer", customerRoutes);
app.use("/api/shipments", shipmentsRoutes);
app.use("/api/shiprocket/profiles", shiprocketProfileRoutes);
app.use("/api/shiprocket", shiprocketRoutes);
app.use("/api/books", bookRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/settings", settingsRoutes);

// 404 handler
app.use((req, res) => res.status(404).json({ ok: false, error: "Not found" }));

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res
    .status(err.status || 500)
    .json({ ok: false, error: err.message || "Server error" });
});

const start = async () => {
  const PORT = process.env.PORT || 5050;
  await mongoose.connect(
    process.env.MONGO_URI
  );
  console.log("✅ Mongo connected");

  // Start abandoned-cart cron
  startAbandonedCron(app);

  app.listen(PORT, () => console.log(`🚀 API listening on :${PORT}`));
};
start();
