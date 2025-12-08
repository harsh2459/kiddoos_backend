import { Router } from "express";
import bodyParser from "body-parser";
import { createRazorpayOrder, razorpayWebhook, verifyPayment, processRefund, getRefundHistory } from "../controller/paymentscontroller.js";
import { requireAuth } from "../controller/_middleware/auth.js";

const router = Router();

// Normal JSON route
router.post("/razorpay/order", createRazorpayOrder);
router.post("/razorpay/verify", verifyPayment);
router.post("/razorpay/webhook", bodyParser.raw({ type: "*/*" }), razorpayWebhook);
router.post("/refund", requireAuth(["admin", "editor"]), processRefund);
router.get("/refunds/:orderId", requireAuth(["admin", "editor"]), getRefundHistory);

export default router;
