import { Router } from "express";
import bodyParser from "body-parser";
import { createRazorpayOrder, razorpayWebhook } from "../controller/paymentscontroller.js";

const router = Router();

// Normal JSON route
router.post("/razorpay/order", createRazorpayOrder);

// Webhook must use RAW body (Buffer), not JSON
router.post(
  "/razorpay/webhook",
  bodyParser.raw({ type: "*/*" }),   // <-- guarantees Buffer in req.body
  razorpayWebhook
);

export default router;
