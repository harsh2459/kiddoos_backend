import { Router } from "express";
import {
  getPublicSettings, getAdminSettings,
  updateSiteSettings, updateThemeSettings,
  updateHomepage, upsertPayments,
  getPopupSettings, getActivePopup, updatePopupSettings, trackPopup
} from "../controller/settingscontroller.js";
import { requireAuth } from "../controller/_middleware/auth.js";

const router = Router();

router.get("/public", getPublicSettings);
router.get("/popup/active", getActivePopup);
router.post("/popup/track", trackPopup);
// Admin only
router.get("/", requireAuth(["admin", "editor"]), getAdminSettings);
router.get("/popup", requireAuth(["admin", "editor"]), getPopupSettings); 
router.put("/site", requireAuth(["admin", "editor"]), updateSiteSettings);
router.put("/theme", requireAuth(["admin", "editor"]), updateThemeSettings);
router.put("/homepage", requireAuth(["admin", "editor"]), updateHomepage);
router.post("/payments", requireAuth(["admin", "editor"]), upsertPayments);
router.put("/popup", requireAuth(["admin", "editor"]), updatePopupSettings);

export default router;
