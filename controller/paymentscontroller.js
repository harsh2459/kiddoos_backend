import Razorpay from "razorpay";
import crypto from "crypto";
import Order from "../model/Order.js";
import Payment from "../model/Payment.js";
import Setting from "../model/Setting.js";

async function getRazorpayCfg() {
  const setting = await Setting.findOne({ key: "payments" }).lean();
  if (!setting?.value) throw new Error("No payments config found");
  const rp = (setting.value.providers || []).find(p => p.id === "razorpay" && p.enabled);
  if (!rp) throw new Error("Razorpay config missing or disabled");
  const { keyId, keySecret } = rp.config || {};
  if (!keyId || !keySecret) throw new Error("Razorpay keyId/keySecret missing");
  return { keyId, keySecret };
}

export const createRazorpayOrder = async (req, res) => {
  try {

    const { amountInRupees, orderId, paymentType } = req.body;

    // Debug logs
    console.log("===================");
    console.log("📦 Payment Request:");
    console.log("amountInRupees:", amountInRupees);
    console.log("paymentType:", paymentType);
    console.log("===================");

    if (!amountInRupees || !orderId || !paymentType) {
      return res.status(400).json({ ok: false, error: "Missing required fields" });
    }

    const { keyId, keySecret } = await getRazorpayCfg();
    const fullPaise = Math.floor(Number(amountInRupees) * 100);
    let amountToCharge = fullPaise;

    console.log("💰 Before check:");
    console.log("fullPaise:", fullPaise);

    // Check for half payment
    if (paymentType === "half_online_half_cod" || paymentType === "half_cod_half_online") {
      amountToCharge = Math.floor(fullPaise / 2);
      console.log("✅ DIVIDED BY 2!");
      console.log("   New amount:", amountToCharge, "paise (₹" + (amountToCharge / 100) + ")");
    } else {
      console.log("❌ NOT DIVIDED - using full amount");
    }

    const shortId = String(orderId).slice(-8);
    const ts = Date.now().toString().slice(-6);
    const receipt = `rcpt_${shortId}_${ts}`;

    const rzp = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const rpOrder = await rzp.orders.create({
      amount: amountToCharge,
      currency: "INR",
      receipt
    });

    console.log("🎯 Razorpay Order Created:");
    console.log("   amount:", rpOrder.amount, "paise (₹" + (rpOrder.amount / 100) + ")");
    console.log("===================");

    // ✅ FIXED: Calculate pendingAmount correctly (in paise, not rupees)
    const pendingAmountPaise = (paymentType === "half_online_half_cod" || paymentType === "half_cod_half_online")
      ? (fullPaise - amountToCharge)
      : 0;

    const payment = await Payment.create({
      orderId,
      paymentType,
      provider: "razorpay",
      providerOrderId: rpOrder.id,
      status: "created",
      paidAmount: 0,
      pendingAmount: pendingAmountPaise / 100, // Convert to rupees for storage
      currency: rpOrder.currency,
      rawResponse: rpOrder
    });

    return res.json({
      ok: true,
      order: rpOrder,
      key: keyId,
      paymentId: payment._id
    });

  } catch (e) {
    console.error("createRazorpayOrder error:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
};

export const verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, paymentId } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !paymentId) {
      return res.status(400).json({ ok: false, error: "Missing verification data" });
    }

    const payment = await Payment.findById(paymentId);
    if (!payment) return res.status(404).json({ ok: false, error: "Payment not found" });

    const { keySecret } = await getRazorpayCfg();
    const generated_signature = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generated_signature !== razorpay_signature) {
      return res.status(400).json({ ok: false, error: "Invalid signature" });
    }

    // Update payment
    payment.providerPaymentId = razorpay_payment_id;
    const totalAmount = payment.paidAmount + payment.pendingAmount; 

    if (payment.paymentType === 'half_online_half_cod' || payment.paymentType === 'half_cod_half_online') {
      payment.paidAmount = Math.floor(totalAmount / 2);
      payment.pendingAmount = totalAmount - payment.paidAmount;
      payment.status = 'partially_paid';
    } else {
      payment.paidAmount = totalAmount;
      payment.pendingAmount = 0;
      payment.status = 'paid';
    }

    payment.paidAt = new Date();
    payment.verifiedAt = new Date();
    await payment.save();

    // Update order status
    const order = await Order.findByIdAndUpdate(
      payment.orderId,
      {
        status: payment.status === 'paid' ? 'confirmed' : 'partially_paid',
        'payment.status': payment.status
      },
      { new: true }
    );

    res.json({ ok: true, verified: true, payment, order });
  } catch (e) {
    console.error("verifyPayment error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
};

export const razorpayWebhook = async (req, res) => {
  try {
    const signature = req.headers["x-razorpay-signature"];
    if (!signature) return res.status(400).send("Missing signature");

    const { keySecret } = await getRazorpayCfg();
    const expected = crypto.createHmac("sha256", keySecret)
      .update(JSON.stringify(req.body))
      .digest("hex");

    if (signature !== expected) {
      console.error("Invalid webhook signature");
      return res.status(400).send("Invalid signature");
    }

    const event = req.body;
    if (event.event === "payment.captured") {
      const paymentEntity = event.payload.payment?.entity;
      if (paymentEntity?.order_id && paymentEntity?.id) {
        await Payment.findOneAndUpdate(
          { providerOrderId: paymentEntity.order_id },
          {
            $set: {
              status: "captured",
              providerPaymentId: paymentEntity.id,
              paidAt: new Date()
            }
          }
        );
      }
    }
    res.json({ ok: true });
  } catch (error) {
    console.error("Webhook processing error:", error);
    res.status(500).json({ ok: false, error: "Processing failed" });
  }
};