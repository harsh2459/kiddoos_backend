import Razorpay from "razorpay";
import crypto from "crypto";
import Order from "../model/Order.js";
import Setting from "../model/Setting.js";

function sanitizeKeyId(s = '') { return s.trim().replace(/,$/, ''); } // drop a single trailing comma
function sanitizeSecret(s = '') { return s.trim().replace(/,$/, ''); }

function isValidKeyId(id) { return /^rzp_(test|live)_[A-Za-z0-9]+$/.test(id); }
function isLikelySecret(s) { return /^[A-Za-z0-9_-]{16,64}$/.test(s); } // len heuristic

async function getRazorpayCfg() {
  const doc = await Setting.findOne({ key: "payments" }).lean();
  const rp = (doc?.value?.providers || []).find(p => p.id === "razorpay");

  const keyIdRaw = process.env.RAZORPAY_KEY_ID || rp?.config?.keyId || "rzp_live_wvJv0kOzLxc3R8";
  const keySecretRaw = process.env.RAZORPAY_KEY_SECRET || rp?.config?.keySecret || "OnRs7f1fAqg66s";

  const keyId = sanitizeKeyId(keyIdRaw);
  const keySecret = sanitizeSecret(keySecretRaw);

  if (!isValidKeyId(keyId) || !isLikelySecret(keySecret)) {
    throw new Error("Invalid Razorpay credentials format (check for trailing commas/spaces and use correct mode).");
  }
  return { keyId, keySecret };
}

function buildRazorpayClient(cfg) {
  return new Razorpay({
    key_id: cfg.keyId,       // <-- map camelCase → snake_case
    key_secret: cfg.keySecret
  });
}

function buildRP({ keyId, keySecret }) {
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

export const createRazorpayOrder = async (req, res, next) => {
  try {
    const { amountInRupees, receipt, orderId } = req.body;
    const amt = Math.round(Number(amountInRupees) * 100);
    if (!amt || amt < 100) return res.status(400).json({ ok: false, error: "Invalid amount" });

    const cfg = await getRazorpayCfg();
    if (!cfg.keyId || !cfg.keySecret) {
      return res.status(500).json({ ok: false, error: "Razorpay is not configured (keys missing)." });
    }

    const rp = buildRP(cfg);
    const rpOrder = await rp.orders.create({
      amount: amt,
      currency: "INR",
      receipt: receipt || `rcpt_${Date.now()}`
    });

    if (orderId) {
      await Order.findByIdAndUpdate(orderId, {
        "payment.provider": "razorpay",
        "payment.orderId": rpOrder.id,
        "payment.status": "created",
        "payment.amount": rpOrder.amount,
        "payment.currency": rpOrder.currency,
      });
    }

    return res.json({ ok: true, order: rpOrder, key: cfg.keyId });
  } catch (e) {
    if (e?.statusCode === 401) {
      // Surface a clear message instead of generic 500
      return res.status(401).json({ ok: false, error: "Razorpay Authentication failed. Check Key ID/Secret." });
    }
    next(e);
  }
};

// webhook unchanged (but ensure body is RAW in the route)
export const razorpayWebhook = async (req, res) => {
  const signature = req.headers["x-razorpay-signature"];
  const secret = (process.env.RAZORPAY_WEBHOOK_SECRET || "").trim();

  const expected = crypto.createHmac("sha256", secret).update(req.body).digest("hex");
  if (signature !== expected) return res.status(400).send("Invalid signature");

  const event = JSON.parse(req.body.toString("utf8"));
  if (event.event === "payment.captured") {
    const payment = event.payload.payment?.entity;
    if (payment?.order_id && payment?.id) {
      await Order.findOneAndUpdate(
        { "payment.orderId": payment.order_id },
        { $set: { "payment.status": "paid", "payment.paymentId": payment.id, "payment.capturedAt": new Date(), status: "paid" } }
      );
    }
  }
  res.json({ ok: true });
};
