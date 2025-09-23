import { Router } from "express";
import { login, seedAdmin, hasAdmin, registerFirstAdmin, createAdmin, getMyShiprocket, setMyShiprocket } from "../controller/authcontroller.js";
import { requireAuth } from "../controller/_middleware/auth.js";
const router = Router();

router.post("/login", login);
router.post("/seed-admin", seedAdmin);
router.get("/has-admin", hasAdmin);
router.post("/register-first-admin", registerFirstAdmin);

// Only an authenticated admin can create more admins
router.post("/create-admin", requireAuth(["admin"]), createAdmin);

router.get("/me/shiprocket", requireAuth(["admin"]), getMyShiprocket);
router.post("/me/shiprocket", requireAuth(["admin"]), setMyShiprocket);

export default router;
 