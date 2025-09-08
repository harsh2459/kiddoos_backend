import { Router } from "express";
import { createRazorpayOrder, razorpayWebhook } from "../controller/paymentscontroller.js";
// import express from "express";

const router = Router();
router.post("/razorpay/order", createRazorpayOrder);

// IMPORTANT: webhook must use raw body, not JSON
// router.post("/razorpay/webhook", express.raw({ type: "*/*" }), razorpayWebhook);
router.post("/razorpay/webhook", razorpayWebhook);

export default router;
