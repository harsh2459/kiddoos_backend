import { Router } from "express";
import { listBooks, getBook, createBook, updateBook, deleteBook, importBooks, exportBooks } from "../controller/BooksController.js";
import { requireAuth, optionalAuth } from "../controller/_middleware/auth.js";
import { uploadImage } from "../controller/uploadscontroller.js";

const router = Router();
router.get("/", optionalAuth, listBooks);
router.get("/:slug", optionalAuth, getBook);

// Admin
router.post("/", requireAuth(["admin", "editor"]), createBook);
router.patch("/:id", requireAuth(["admin", "editor"]), updateBook);
router.delete("/:id", requireAuth(["admin"]), deleteBook);

// Import and Export books
// Import and Export books
router.post("/import", requireAuth(["admin", "editor"]), uploadImage, importBooks);  // Route for importing books
router.get("/export",  requireAuth(["admin", "editor"]), exportBooks);   // Route for exporting books

export default router;
