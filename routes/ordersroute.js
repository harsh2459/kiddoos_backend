import { Router } from "express";
import { createOrder, listOrders, updateOrder, deleteOrder, onOrderPaid ,getOrder} from "../controller/orderscontroller.js";
import { requireAuth } from "../controller/_middleware/auth.js";
const router = Router();

router.post("/", createOrder);
router.get("/", requireAuth(["admin", "editor"]), listOrders);
router.put("/:id/status", requireAuth(["admin", "editor"]), updateOrder);
router.delete("/:id", deleteOrder);
router.get("/:id", getOrder);
// Internal: Order paid callback
router.post('/paid', onOrderPaid);

export default router;
