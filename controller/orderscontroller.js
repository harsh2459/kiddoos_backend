import mongoose from "mongoose";
import Order from "../model/Order.js";
import Customer from "../model/Customer.js";
import { createSrForOrder, findSrOwnerUserId } from "./_services/srOrdershelper.js";
import { sendBySlug } from "../utils/mailer.js";


export async function onOrderPaid(order) {
  try {
    const customer = await Customer.findById(order.customerId);
    if (!customer) return;

    // stop abandoned program and clear cart after successful order (optional)
    customer.resetAbandonedProgram("order placed");
    customer.cart.items = [];
    customer.cart.totals = { subTotal: 0, taxAmount: 0, shippingAmount: 0, grandTotal: 0 };
    customer.cart.expiresAt = null;
    await customer.save();

    // Send order email (make sure template with slug "order_paid" exists and is linked to a MailSender)
    await sendBySlug("order_paid", customer.email, {
      name: customer.name || "there",
      order_id: order._id,
      amount: order.totals?.grandTotal || order.amount,
      items: order.items?.length || 0,
      order_date: new Date(order.createdAt).toLocaleString("en-IN"),
    });
  } catch (e) {
    console.error("order-paid-email-failed:", e?.message || e);
  }
}

export async function createOrder(req, res, next) {
  try {
    const b = req.body || {};
    const items = Array.isArray(b.items) ? b.items.map(i => ({
      bookId: i.bookId,
      qty: Math.max(1, Number(i.qty || 1)),
      unitPrice: Number(i.unitPrice ?? i.price ?? 0)
    })) : [];

    if (!items.length) {
      return res.status(400).json({ ok: false, error: "items required" });
    }

    const amount = items.reduce((s, i) => s + i.qty * i.unitPrice, 0);

    const shipping = {
      name: b.shipping?.name || b.customer?.name || "",
      phone: b.shipping?.phone || b.customer?.phone || "",
      email: (b.shipping?.email || b.customer?.email || "").toLowerCase(),
      address: b.shipping?.address || b.shipping?.address1 || "",
      city: b.shipping?.city || "",
      state: b.shipping?.state || "",
      pincode: b.shipping?.pincode || b.shipping?.postalCode || "",
      weight: Number(b.shipping?.weight ?? 0.5),
      length: Number(b.shipping?.length ?? 20),
      breadth: Number(b.shipping?.breadth ?? 15),
      height: Number(b.shipping?.height ?? 3),
    };

    const order = await Order.create({
      items,
      amount,
      email: shipping.email,
      phone: shipping.phone,
      shipping,
      status: "pending",
      payment: { provider: "razorpay", status: "pending" }
    });

    // fire-and-forget: clear cart (if a customer exists) + send order mail + create SR
    setImmediate(async () => {
      try {
        // 1) link customer by auth or email, then clear cart + stop abandoned program
        let customer = null;
        if (req.customerId) {
          customer = await Customer.findById(req.customerId);
        } else if (shipping.email) {
          customer = await Customer.findOne({ email: shipping.email });
        }

        if (customer) {
          customer.cart.items = [];
          customer.cart.totals = { subTotal: 0, taxAmount: 0, shippingAmount: 0, grandTotal: 0 };
          customer.cart.lastActivityAt = new Date();
          customer.cart.expiresAt = null;
          customer.resetAbandonedProgram("order placed");
          await customer.save();
        }

        // 2) send order confirmation (needs an active template with slug "order_placed")
        if (shipping.email) {
          try {
            await sendBySlug("order_placed", shipping.email, {
              name: shipping.name || "",
              order_id: order._id,
              amount: order.amount ?? amount,
            });
          } catch (e) {
            console.warn("order email failed:", e.message);
          }
        }

        // 3) SR creation (your existing logic)
        try {
          let ownerId;
          try { ownerId = await findSrOwnerUserId(); } catch { }
          if (ownerId) {
            await createSrForOrder(order._id, ownerId);
            if (process.env.SR_AUTO_ASSIGN_AWB === "1") {
              // optionally assign AWB here
            }
          }
        } catch (e) {
          console.error("Auto SR create failed", e);
        }

      } catch (e) {
        console.error("post-create hooks failed", e);
      }
    });

    res.json({ ok: true, orderId: order._id });
  } catch (e) { next(e); }
}


export const listOrders = async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const q = String(req.query.q || "").trim();
    const status = String(req.query.status || "").trim();

    const where = {};
    if (status) where.status = status;
    if (q) {
      where.$or = [
        (mongoose.isValidObjectId(q) ? { _id: q } : null),
        { email: new RegExp(q, "i") },
        { "shipping.phone": new RegExp(q, "i") },
        { "shipping.name": new RegExp(q, "i") }
      ].filter(Boolean);
    }

    const total = await Order.countDocuments(where);
    const items = await Order.find(where)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    res.json({ ok: true, items, total, page, limit });
  } catch (e) { next(e); }
};

export const updateOrderStatus = async (req, res) => {
  const { status } = req.body;
  const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true });
  if (!order) return res.status(404).json({ ok: false, error: "Not found" });
  res.json({ ok: true, order });
};
