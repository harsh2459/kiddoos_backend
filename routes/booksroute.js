import { Router } from "express";
import { listBooks, getBook, createBook, updateBook, deleteBook } from "../controller/booksController.js";
import { requireAuth, optionalAuth } from "../controller/_middleware/auth.js";

const router = Router();
router.get("/", optionalAuth, listBooks);
router.get("/:slug", optionalAuth, getBook);

// Admin
router.post("/", requireAuth(["admin", "editor"]), createBook);
router.put("/:id", requireAuth(["admin", "editor"]), updateBook);
router.delete("/:id", requireAuth(["admin"]), deleteBook);

export default router;
