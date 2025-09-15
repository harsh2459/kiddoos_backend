import { Router } from "express";
import {
  getPublicSettings, getAdminSettings,
  updateSiteSettings, updateThemeSettings,
  updateHomepage, upsertPayments
} from "../controller/settingscontroller.js";
import { requireAuth } from "../controller/_middleware/auth.js";

const router = Router();

router.get("/public", getPublicSettings);

// Admin only
router.get("/", requireAuth(["admin", "editor"]), getAdminSettings);
router.put("/site", requireAuth(["admin", "editor"]), updateSiteSettings);
router.put("/theme", requireAuth(["admin", "editor"]), updateThemeSettings);
router.put("/homepage", requireAuth(["admin", "editor"]), updateHomepage);
router.post("/payments", requireAuth(["admin", "editor"]), upsertPayments);

export default router;
