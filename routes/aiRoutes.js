import express from "express";
import { analyzeBook, getAvailableModels } from "../controller/AiController.js";
// Import your existing auth middleware
import { requireAuth } from "../controller/_middleware/auth.js";

const router = express.Router();

// The main endpoint used by AddBook.jsx
router.post("/analyze", requireAuth(["admin"]), analyzeBook);
router.get("/models", requireAuth(["admin"]), getAvailableModels);
export default router;