import Razorpay from "razorpay";
import crypto from "crypto";
import Order from "../model/Order.js";
import Setting from "../model/Setting.js";

// const rp = new Razorpay({
//   key_id: process.env.RAZORPAY_KEY_ID,
//   key_secret: process.env.RAZORPAY_KEY_SECRET
// });

// Create a Razorpay order from our order amount (rupees in request)
// export const createRazorpayOrder = async (req, res, next) => {
//   try {
//     const { amountInRupees, receipt, orderId } = req.body; // orderId is our DB order (optional)
//     const amountPaise = Math.round(Number(amountInRupees) * 100);
//     const rpOrder = await rp.orders.create({
//       amount: amountPaise, currency: "INR",
//       receipt: receipt || `rcpt_${Date.now()}`
//     });
//     if (orderId) {
//       await Order.findByIdAndUpdate(orderId, { "payment.orderId": rpOrder.id });
//     }
//     res.json({ ok:true, order: rpOrder, key: process.env.RAZORPAY_KEY_ID });
//   } catch (e) { next(e); }
// };

// // Webhook endpoint (set RAW body in app route file)
// export const razorpayWebhook = async (req, res) => {
//   const signature = req.headers["x-razorpay-signature"];
//   const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
//   const body = req.body; // raw buffer via express.raw
//   const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
//   if (signature !== expected) return res.status(400).send("Invalid signature");

//   const event = JSON.parse(body.toString());
//   if (event.event === "payment.captured") {
//     const rpOrderId = event.payload.payment.entity.order_id;
//     const rpPaymentId = event.payload.payment.entity.id;
//     await Order.findOneAndUpdate(
//       { "payment.orderId": rpOrderId },
//       { "payment.status": "paid", "payment.paymentId": rpPaymentId, status: "paid" }
//     );
//   }
//   res.json({ ok:true });
// };

export const createRazorpayOrder = (req, res) => {
  return res.status(503).json({ ok: false, error: "Payments not configured yet" });
};

export const razorpayWebhook = (req, res) => {
  return res.status(503).json({ ok: false, error: "Payments not configured yet" });
};

async function getPaymentConfig(id){
  const doc = await Setting.findOne({ key: "payments" });
  const p = (doc?.value?.providers || []).find(x => x.id === id);
  return p || null;
}