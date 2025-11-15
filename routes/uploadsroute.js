import { Router } from "express";
import { upload, uploadImage, deleteImage } from "../controller/uploadscontroller.js";
import { requireAuth } from "../controller/_middleware/auth.js";

const router = Router();
router.post("/image", requireAuth(["admin", "editor"]), upload.array("files", 10), uploadImage);
router.delete("/image", requireAuth(["admin", "editor"]), deleteImage);
export default router;
