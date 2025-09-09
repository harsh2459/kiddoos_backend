// backend/controller/uploadscontroller.js
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ensure folder exists
const UPLOAD_DIR = path.join(__dirname, "..", "public", "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// simple disk storage (can swap to S3/Cloudinary later)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    const name = Date.now() + "_" + Math.random().toString(36).slice(2) + ext;
    cb(null, name);
  }
});
export const upload = multer({ storage });

export const uploadImage = (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "No file uploaded" });

  // relative path served by Express static
  const rel = `/public/uploads/${req.file.filename}`;

  // absolute base for browsers on a different origin/port
  const bases = (process.env.PUBLIC_URL_BASE || "").split(",").map(s => s.trim()).filter(Boolean);
  const base = bases[0] || `${req.protocol}://${req.get("host")}`;

  // return both (absolute for the UI, relative for internal use if needed)
  return res.json({ ok: true, url: `${base}${rel}`, path: rel });
};
