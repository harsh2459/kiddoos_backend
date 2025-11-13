import { Router } from "express";
import {
  listBooks,
  getBook,
  getBookById,
  createBook,
  updateBook,
  deleteBook,
  importBooks,
  exportBooks,
} from "../controller/BooksController.js";
import { requireAuth } from "../controller/_middleware/auth.js";
import multer from "multer";

const router = Router();

// ✅ Configure multer for Excel/CSV files
const excelUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1
  },
  fileFilter: (req, file, cb) => {
    console.log("📋 Multer fileFilter - Checking file:", {
      fieldname: file.fieldname,
      originalname: file.originalname,
      mimetype: file.mimetype
    });

    const validTypes = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
    ];

    const validExtensions = /\.(xlsx|xls|csv)$/i;
    const hasValidType = validTypes.includes(file.mimetype);
    const hasValidExt = validExtensions.test(file.originalname);

    if (hasValidType || hasValidExt) {
      console.log("✅ File accepted by multer");
      cb(null, true);
    } else {
      console.log("❌ File rejected by multer");
      cb(new Error(`Invalid file type. Only Excel/CSV allowed.`));
    }
  },
});

// ✅ Optional auth middleware - attaches user if token exists, but doesn't block
const optionalAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (token) {
      const jwt = await import("jsonwebtoken");
      const decoded = jwt.default.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
      console.log("✅ User authenticated:", decoded.email, "role:", decoded.role);
    } else {
      console.log("ℹ️ No token - continuing as public user");
    }
  } catch (error) {
    console.log("⚠️ Invalid token - continuing as public user");
  }
  next();
};

// ✅ CRITICAL: Route order matters!

// Import/Export routes (admin only, BEFORE any dynamic routes)
router.post(
  "/import",
  requireAuth(["admin", "editor"]),
  (req, res, next) => {
    console.log("🎯 Route hit: POST /api/books/import");
    console.log("📦 Request headers:", req.headers);
    next();
  },
  excelUpload.single("file"),
  (req, res, next) => {
    console.log("✅ Multer processed, file:", req.file ? "EXISTS" : "MISSING");
    if (!req.file) {
      console.log("❌ No file found in req.file");
    }
    next();
  },
  importBooks
);

router.get("/export", requireAuth(["admin", "editor"]), exportBooks);

router.get("/admin/:idOrSlug", requireAuth(["admin", "editor"]), getBookById);
// Admin CRUD operations
router.post("/", requireAuth(["admin", "editor"]), createBook);
router.patch("/:id", requireAuth(["admin", "editor"]), updateBook);
router.delete("/:id", requireAuth(["admin", "editor"]), deleteBook);

// ✅ LIST route with OPTIONAL auth - allows both admin and public access
router.get("/", optionalAuth, listBooks);

// Public single book route (MUST be LAST)
router.get("/:slug", getBook);

export default router;