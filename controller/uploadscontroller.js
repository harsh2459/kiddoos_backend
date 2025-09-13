// backend/controller/uploadscontroller.js
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { getBaseFromReq, toAbsolute } from "../utils/url.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UPLOAD_DIR = path.join(__dirname, "..", "public", "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    const name = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  }
});
export const upload = multer({ storage });

export const uploadImage = (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: "No file uploaded" });

  const relPath = `/public/uploads/${req.file.filename}`;
  const previewUrl = toAbsolute(relPath, getBaseFromReq(req));

  // IMPORTANT: the client should store `path` in DB, not `previewUrl`.
  return res.json({ ok: true, path: relPath, previewUrl });
};
