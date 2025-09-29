import { Router } from "express";
import { upload, uploadImage } from "../controller/uploadscontroller.js";
import { requireAuth } from "../controller/_middleware/auth.js";

const router = Router();
router.post("/image", requireAuth(["admin","editor"]), upload.array("files",10), uploadImage);
export default router;
