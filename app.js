// app.js
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
app.set("trust proxy", 1); // so req.protocol = https on Render
export const PUBLIC_BASES = (process.env.PUBLIC_URL_BASE || "")
  .split(",").map(s => s.trim().replace(/\/+$/, "")).filter(Boolean);
// Security
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// Body
app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: true }));

/** ---------- CORS that supports Vercel prod + previews + localhost ---------- */
const allowListExact = new Set([
  "https://kiddos-frontend.vercel.app",
  "http://localhost:3000",
  "https://www.kiddosintellect.com",
  "http://localhost:5173",
  "https://kiddosintellect.com"
]);

const vercelPreviewRegex = /^https:\/\/kidoos-frontend(-git-[a-z0-9-]+)?\.vercel\.app$/;

app.use(cors({
  origin: (origin, cb) => {
    // Non-browser clients or same-origin
    if (!origin) return cb(null, true);

    if (allowListExact.has(origin) || vercelPreviewRegex.test(origin)) {
      return cb(null, true);
    }
    return cb(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: false,         // set true only if you use cookies
  optionsSuccessStatus: 204,
}));

app.use(morgan("dev"));

// Static
app.use(
  "/public",
  (req, res, next) => { res.setHeader("Cross-Origin-Resource-Policy", "cross-origin"); next(); },
  express.static(path.join(__dirname, "public"))
);

// routes
import bookRoutes from "./routes/booksroute.js";
import orderRoutes from "./routes/ordersroute.js";
import paymentRoutes from "./routes/paymentsroute.js";
import uploadRoutes from "./routes/uploadsroute.js";
import authRoutes from "./routes/authroute.js";
import settingsRoutes from "./routes/settingsroute.js";
import bluedartroute from './routes/bluedartroute.js';
import customerRoutes from "./routes/customerRoutes.js";
import emailTemplateRoutes from "./routes/emailTemplateRoutes.js";
import mailSenderRoutes from "./routes/mailSenderRoutes.js";
import { exportBooks, } from "./controller/BooksController.js";
import { onOrderPaid } from './controller/orderscontroller.js';
import blueDartProfileRoute from './routes/blueDartProfileRoute.js';
import labelRoute from './routes/labelRoute.js';

app.use('/api/labels', labelRoute);
app.use('/uploads', express.static('uploads'));
app.use("/api/bluedart-profiles", blueDartProfileRoute);
app.use("/api/admin/mail-senders", mailSenderRoutes);
app.use("/api/admin/email-templates", emailTemplateRoutes);
app.use("/api/auth/customer", customerRoutes);
app.use("/api/customer", customerRoutes);
app.use("/api/bluedart", bluedartroute);
app.use("/api/books", bookRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/settings", settingsRoutes);
app.post('/api/orders/place', onOrderPaid);
app.get("/api/export", exportBooks);

// 404
app.use((req, res) => res.status(404).json({ ok: false, error: "Not found" }));

// error
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ ok: false, error: err.message || "Server error" });
});

// ----- DB connect and cron start (no listen here) -----
const ensureDb = (async () => {
  await mongoose.connect(process.env.MONGO_URI, {
    tls: true,
    tlsAllowInvalidCertificates: true,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });
  console.log("Mongo connected");
  startAbandonedCron(app);
})();

export { app, ensureDb };

