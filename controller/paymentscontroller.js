import Razorpay from "razorpay";
import crypto from "crypto";
import Order from "../model/Order.js";
import Payment from "../model/Payment.js";
import Setting from "../model/Setting.js";

// Fetch Razorpay credentials from DB settings
async function getRazorpayCfg() {
  const setting = await Setting.findOne({ key: "payments" }).lean();
  if (!setting?.value) {
    throw new Error("No payments config found");
  }
  const rp = (setting.value.providers || []).find(
    (p) => p.id === "razorpay" && p.enabled
  );
  if (!rp) {
    throw new Error("Razorpay config missing or disabled");
  }
  const { keyId, keySecret } = rp.config || {};
  if (!keyId || !keySecret) {
    throw new Error("Razorpay keyId/keySecret missing in config");
  }
  return { keyId, keySecret };
}

export const createRazorpayOrder = async (req, res) => {
  try {
    console.log("Request body:", req.body);
    const { amountInRupees, orderId, paymentType } = req.body;
    if (!amountInRupees || !orderId || !paymentType) {
      return res
        .status(400)
        .json({ ok: false, error: "Missing required fields" });
    }

    // Load Razorpay credentials
    const { keyId, keySecret } = await getRazorpayCfg();

    // Convert rupees to paise
    const fullPaise = Math.floor(Number(amountInRupees) * 100);

    // Determine amount to charge now
    let amountToCharge = fullPaise;
    if (paymentType === "half_online_half_cod") {
      amountToCharge = Math.floor(fullPaise / 2);
    }

    // Build a short receipt string under 40 chars
    const shortId = String(orderId).slice(-8);    // last 8 of orderId
    const ts = Date.now().toString().slice(-6);   // last 6 digits of timestamp
    const receipt = `rcpt_${shortId}_${ts}`;      // e.g. "rcpt_ab12cd34_567890"

    // Create Razorpay order
    const rzp = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const rpOrder = await rzp.orders.create({
      amount: amountToCharge,
      currency: "INR",
      receipt
    });
    console.log("Razorpay order created:", rpOrder.id);

    // Save payment record
    const payment = await Payment.create({
      orderId,
      paymentType,
      provider: "razorpay",
      providerOrderId: rpOrder.id,
      status: "created",
      paidAmount: 0,
      pendingAmount:
        paymentType === "half_online_half_cod"
          ? fullPaise - amountToCharge
          : 0,
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

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !paymentId)
      return res.status(400).json({ ok: false, error: "Missing verification data" });

    const payment = await Payment.findById(paymentId);
    if (!payment) return res.status(404).json({ ok: false, error: "Payment not found" });

    const { keySecret } = await getRazorpayCfg();
    const generated_signature = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generated_signature !== razorpay_signature)
      return res.status(400).json({ ok: false, error: "Invalid signature" });

    // Update payment record
    payment.providerPaymentId = razorpay_payment_id;
    payment.paidAmount = payment.pendingAmount > 0 ? payment.pendingAmount : payment.paidAmount + payment.pendingAmount;

    if (payment.paymentType === 'half_online_half_cod') {
      payment.status = 'partially_paid';
      payment.pendingAmount = payment.paidAmount; // Remaining half for COD
    } else {
      payment.status = 'paid';
      payment.pendingAmount = 0;
    }

    payment.paidAt = new Date();
    payment.verifiedAt = new Date();
    await payment.save();

    // Update order status
    await Order.findByIdAndUpdate(payment.orderId, {
      status: payment.status === 'paid' ? 'confirmed' : 'partially_paid'
    });

    res.json({ ok: true, verified: true, payment });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
};

// Simplified webhook for now (add WebhookEvent model later if needed)
export const razorpayWebhook = async (req, res) => {
  try {
    const signature = req.headers["x-razorpay-signature"];

    if (!signature) {
      return res.status(400).send("Missing signature");
    }

    const { keySecret } = await getRazorpayCfg();
    const expected = crypto.createHmac("sha256", keySecret)
      .update(req.body)
      .digest("hex");

    if (signature !== expected) {
      console.error("Invalid webhook signature");
      return res.status(400).send("Invalid signature");
    }

    const event = JSON.parse(req.body.toString("utf8"));

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
