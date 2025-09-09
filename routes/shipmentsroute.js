// routes/shipments.route.js
import { Router } from "express";
import { requireAuth } from "../controller/_middleware/auth.js";
import Order from "../model/Order.js";

const r = Router();
r.use(requireAuth(["admin"]));

// GET /api/shipments?q=&status=&page=1&limit=20
r.get("/", async (req, res, next) => {
  try {
    const page  = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const q     = String(req.query.q || "").trim();
    const status= String(req.query.status || "").trim();

    const where = { "shipping.sr.shipmentId": { $exists: true, $ne: null } };
    if (status) where.status = status;
    if (q) {
      where.$or = [
        { _id: q.match(/^[0-9a-fA-F]{24}$/) ? q : null },
        { email: new RegExp(q, "i") },
        { "shipping.phone": new RegExp(q, "i") },
        { "shipping.name": new RegExp(q, "i") }
      ].filter(Boolean);
    }

    const total = await Order.countDocuments(where);
    const items = await Order.find(where).sort({ createdAt: -1 }).skip((page-1)*limit).limit(limit).lean();

    res.json({ ok: true, items, total, page, limit });
  } catch (e) { next(e); }
});

export default r;
