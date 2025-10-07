import { Router } from "express";
import bodyParser from "body-parser";
import { createRazorpayOrder, razorpayWebhook, verifyPayment } from "../controller/paymentscontroller.js";

const router = Router();

// Normal JSON route
router.post("/razorpay/order", createRazorpayOrder);
router.post("/razorpay/verify", verifyPayment);
router.post("/razorpay/webhook", bodyParser.raw({ type: "*/*" }), razorpayWebhook);

export default router;
