import Order from "../model/Order.js";
import { createSrForOrder, findSrOwnerUserId } from "./_services/srOrdershelper.js";


export async function createOrder(req, res, next) {
  try {
    const b = req.body || {};
    const items = Array.isArray(b.items) ? b.items.map(i => ({
      bookId: i.bookId,                             // required on schema
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
      email: b.shipping?.email || b.customer?.email || "",
      address: b.shipping?.address || b.shipping?.address1 || "",
      city: b.shipping?.city || "",
      state: b.shipping?.state || "",
      pincode: b.shipping?.pincode || b.shipping?.postalCode || "",
      // parcel dims (optional; SR defaults will take over if blank)
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

    // fire-and-forget SR creation so checkout is fast
    setImmediate(async () => {
      try {
        let ownerId;
        try { ownerId = await findSrOwnerUserId(); } catch { /* no active profile */ }
        if (ownerId) {
          await createSrForOrder(order._id, ownerId);
          if (process.env.SR_AUTO_ASSIGN_AWB === "1") {
            // optional: call srAssignAwb here
          }
        }
      } catch (e) {
        console.error("Auto SR create failed", e);
      }
    });

    res.json({ ok: true, orderId: order._id });
  } catch (e) { next(e); }
}

export const listOrders = async (req, res, next) => {
  try {
    const page  = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const q     = String(req.query.q || "").trim();
    const status= String(req.query.status || "").trim();

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
