import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }, // <— key fix
  contentSecurityPolicy: false,           // dev-friendly; optional
  crossOriginEmbedderPolicy: false        // dev-friendly; optional
}));
// basic middlewares
app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: true }));
// Your existing CORS for APIs
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") || "*", credentials: false }));
// app.use(helmet());
app.use(morgan("dev"));

// Serve uploaded files and explicitly allow embedding
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

app.use("/api/books", bookRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/settings", settingsRoutes);

// 404
app.use((req, res) => res.status(404).json({ ok: false, error: "Not found" }));

// global error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ ok: false, error: err.message || "Server error" });
});

const start = async () => {
  const PORT = process.env.PORT || 5050;
  await mongoose.connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/catalogue");
  console.log("Mongo connected");
  app.listen(PORT, () => console.log("API listening on :" + PORT));
};
start();
