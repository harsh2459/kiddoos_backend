import { Router } from "express";
import { createOrder, listOrders, updateOrderStatus } from "../controller/orderscontroller.js";
import { requireAuth } from "../controller/_middleware/auth.js";
const router = Router();

router.post("/", createOrder);
router.get("/", requireAuth(["admin","editor"]), listOrders);
router.put("/:id/status", requireAuth(["admin","editor"]), updateOrderStatus);

export default router;
