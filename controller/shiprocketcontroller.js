import Order from "../model/Order.js";
import User from "../model/User.js";
import { sr } from "./_services/shiprocket.js";

function dimsFrom(order) {
  const w = Number(order.shipping?.weight || process.env.SR_DEF_WEIGHT || 0.5);
  const L = Number(order.shipping?.length || process.env.SR_DEF_LENGTH || 20);
  const B = Number(order.shipping?.breadth || process.env.SR_DEF_BREADTH || 15);
  const H = Number(order.shipping?.height || process.env.SR_DEF_HEIGHT || 3);
  return { w, L, B, H };
}

function pickDeep(obj, keys) {
  const stack = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    for (const k of Object.keys(cur)) {
      if (keys.includes(k)) return cur[k];
      const v = cur[k];
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return "";
}

async function pickupLocationFor(userId) {
  const p = await activeProfile(userId);
  return p?.pickupLocation || process.env.SR_PICKUP_LOCATION || "Default";
}

async function activeProfile(userId) {
  const u = await User.findById(userId)
    .select("integrations.shiprocket.profiles")
    .lean();
  const list = u?.integrations?.shiprocket?.profiles || [];
  return list.find(p => p.active) || null;
}

async function dimsFor(userId, order) {
  const p = await activeProfile(userId);
  return {
    weight: Number(order.shipping?.weight ?? p?.defaults?.weight ?? process.env.SR_DEF_WEIGHT ?? 0.5),
    length: Number(order.shipping?.length ?? p?.defaults?.length ?? process.env.SR_DEF_LENGTH ?? 20),
    breadth: Number(order.shipping?.breadth ?? p?.defaults?.breadth ?? process.env.SR_DEF_BREADTH ?? 15),
    height: Number(order.shipping?.height ?? p?.defaults?.height ?? process.env.SR_DEF_HEIGHT ?? 3),
  };
}

export const srServiceability = async (req, res, next) => {
  try {
    const {
      pickup_postcode, delivery_postcode,
      cod = 0, weight, length, breadth, height
    } = req.body || {};
    const params = {
      pickup_postcode: String(pickup_postcode),
      delivery_postcode: String(delivery_postcode),
      cod: Number(cod) || 0,
      weight: Number(weight) || Number(process.env.SR_DEF_WEIGHT || 0.5),
      length: Number(length) || Number(process.env.SR_DEF_LENGTH || 20),
      breadth: Number(breadth) || Number(process.env.SR_DEF_BREADTH || 15),
      height: Number(height) || Number(process.env.SR_DEF_HEIGHT || 3)
    };
    const { data } = await sr("get", "/courier/serviceability/", { params }, { userId: req.user._id });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
};

export const srCreateOrders = async (req, res, next) => {
  try {
    const { orderIds = [] } = req.body || {};
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ ok: false, error: "orderIds required" });
    }

    const orders = await Order.find({ _id: { $in: orderIds } }).lean();
    const pickup_location = await pickupLocationFor(req.user._id);

    const success = [];
    const skipped = [];
    const failed = [];

    for (const o of orders) {
      // 1) Avoid duplicates
      if (o?.shipping?.sr?.shipmentId) {
        skipped.push({
          id: o._id,
          reason: "Shipment already exists",
          shipmentId: o.shipping.sr.shipmentId
        });
        continue;
      }

      // 2) Validate minimum shipping fields
      const ship = o.shipping || {};
      const required = ["address", "city", "state", "pincode", "phone"];
      const missing = required.filter(k => !String(ship[k] || "").trim());
      if (missing.length) {
        failed.push({ id: o._id, error: `Missing shipping fields: ${missing.join(", ")}` });
        continue;
      }

      // 3) Build items + subtotal
      const order_items = (o.items || []).map(it => ({
        name: it.title || it.name || "Book",
        sku: it.inventory?.sku || it.sku || String(it.bookId || it._id || "SKU"),
        units: Number(it.qty || 1),
        selling_price: Number(it.unitPrice ?? it.price ?? 0),
        discount: 0,
        tax: Number(it.tax || 0)
      }));
      const sub_total = order_items.reduce((s, it) => s + it.selling_price * it.units, 0);

      // 4) Dimensions from active profile (or override/env)
      const { weight, length, breadth, height } = await dimsFor(req.user._id, o);

      // 5) Payment method (optional): Prepaid if paid, else COD
      const payment_method = (o.payment?.status === "paid") ? "Prepaid" : "COD";

      // 6) Payload to SR
      const payload = {
        order_id: String(o._id),
        order_date: new Date(o.createdAt || Date.now()).toISOString().slice(0, 19).replace("T", " "),
        pickup_location,
        billing_customer_name: ship.name || "Customer",
        billing_last_name: "",
        billing_address: ship.address || "",
        billing_city: ship.city || "",
        billing_pincode: ship.pincode || "",
        billing_state: ship.state || "",
        billing_country: ship.country || "India",
        billing_email: ship.email || "",
        billing_phone: ship.phone || "",
        shipping_is_billing: true,
        shipping_country: ship.country || "India",
        order_items,
        payment_method,
        sub_total,
        length, breadth, height, weight
      };

      try {
        const { data } = await sr("post", "/orders/create/adhoc", { data: payload }, { userId: req.user._id });

        const srOrderId = String(pickDeep(data, ["order_id", "orderId"])) || "";
        const srShipmentId = String(pickDeep(data, ["shipment_id", "shipmentId"])) || "";

        // persist
        if (!srShipmentId) {
          await Order.updateOne(
            { _id: o._id },
            {
              $set: {
                "shipping.provider": "shiprocket",
                "shipping.sr.createStatus": "failed",
                "shipping.sr.createError": data?.message || "No shipmentId returned",
                "shipping.sr.lastCreateResp": data
              }
            }
          );
          failed.push({ id: o._id, error: data?.message || "No shipmentId returned" });
          continue;
        }

        success.push({ id: o._id, orderId: srOrderId, shipmentId: srShipmentId });

      } catch (err) {
        failed.push({
          id: o._id,
          error: err.response?.data || err.message
        });
      }
    }

    res.json({ ok: true, success, skipped, failed });
  } catch (e) { next(e); }
};

export const srAssignAwb = async (req, res, next) => {
  try {
    const { orderIds = [], courier_id } = req.body || {};
    if (!orderIds.length) return res.status(400).json({ ok: false, error: "orderIds required" });

    const orders = await Order.find({
      _id: { $in: orderIds },
      "shipping.sr.shipmentId": { $exists: true, $nin: [null, ""] }
    }).lean();
    const results = [];

    for (const o of orders) {
      try {
        const payload = { shipment_id: o.shipping.sr.shipmentId };
        if (courier_id) payload.courier_id = courier_id;

        const { data } = await sr("post", "/courier/assign/awb", { data: payload }, { userId: req.user._id });
        console.log(data.response.data?.awb_code);
        console.log(data.response.data?.courier_name);
        
        await Order.updateOne(
          { _id: o._id },
          {
            $set: {
              "shipping.sr.awb": data.response.data?.awb_code || data.awb_code || "",
              "shipping.sr.courier": data.response.data?.courier_name || data.courier_name || ""
            }
          }
        );
        results.push({ ok: true, id: o._id, awb: data.response?.awb_code || data.awb_code || "", courier: data.response?.courier_name || data.courier_name || "" });
      } catch (e) {
        results.push({ ok: false, id: o._id, error: srErr(e) });
      }
    }
    res.json({ ok: true, results });
  } catch (e) { next(e); }
};

export const srSchedulePickup = async (req, res, next) => {
  try {
    const { orderIds = [], pickup_date } = req.body || {};
    const shipments = await Order.find({ _id: { $in: orderIds }, "shipping.sr.shipmentId": { $exists: true, $ne: null } })
      .distinct("shipping.sr.shipmentId");

    if (!shipments.length) return res.status(400).json({ ok: false, error: "No shipmentIds found" });

    const { data } = await sr("post", "/courier/generate/pickup", { data: { shipment_id: shipments, pickup_date } }, { userId: req.user._id });

    await Order.updateMany(
      { _id: { $in: orderIds } },
      { $set: { "shipping.sr.pickupScheduledAt": pickup_date ? new Date(pickup_date) : new Date() } }
    );

    res.json({ ok: true, data });
  } catch (e) { next(e); }
};

export const srGenerateManifest = async (req, res, next) => {
  try {
    const { orderIds = [] } = req.body || {};
    const shipments = await Order.find({ _id: { $in: orderIds }, "shipping.sr.shipmentId": { $exists: true, $ne: null } })
      .distinct("shipping.sr.shipmentId");

    if (!shipments.length) return res.status(400).json({ ok: false, error: "No shipmentIds found" });

    await sr("post", "/manifests/generate", { data: { shipment_id: shipments } }, { userId: req.user._id });
    const { data } = await sr("post", "/manifests/print", { data: { shipment_id: shipments } }, { userId: req.user._id });

    await Order.updateMany(
      { _id: { $in: orderIds } },
      { $set: { "shipping.sr.manifestUrl": data?.manifest_url || data?.manifest_url_pdf || "" } }
    );

    res.json({ ok: true, data });
  } catch (e) { next(e); }
};

export const srGenerateLabel = async (req, res, next) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { orderIds = [] } = req.body || {};
    const shipments = await Order.find({ _id: { $in: orderIds }, "shipping.sr.shipmentId": { $exists: true, $ne: null } })
      .distinct("shipping.sr.shipmentId");
    if (!shipments.length) return res.status(400).json({ ok: false, error: "No shipmentIds found" });
    const { data } = await sr("post", "/courier/generate/label", { data: { shipment_id: shipments } }, { userId });
    await Order.updateMany(
      { _id: { $in: orderIds } },
      { $set: { "shipping.sr.labelUrl": data?.label_url || "" } }
    );

    res.json({ ok: true, data });
  } catch (e) { next(e); }
};

export const srGenerateInvoice = async (req, res, next) => {
  try {
    const { orderIds = [] } = req.body || {};
    const shipments = await Order.find({ _id: { $in: orderIds }, "shipping.sr.shipmentId": { $exists: true, $ne: null } })
      .distinct("shipping.sr.shipmentId");
    if (!shipments.length) return res.status(400).json({ ok: false, error: "No shipmentIds found" });

    const { data } = await sr("post", "/orders/print/invoice", { data: { shipment_id: shipments } }, { userId: req.user._id });

    await Order.updateMany(
      { _id: { $in: orderIds } },
      { $set: { "shipping.sr.invoiceUrl": data?.invoice_url || "" } }
    );

    res.json({ ok: true, data });
  } catch (e) { next(e); }
};

export const srTrackAwb = async (req, res, next) => {
  try {
    const { awb } = req.params;
    const { data } = await sr("get", `/courier/track/awb/${encodeURIComponent(awb)}`, undefined, { userId: req.user._id });

    // Optional: persist latest tracking snapshot
    const status =
      data?.tracking_data?.shipment_status_current ||
      data?.tracking_data?.shipment_status ||
      data?.current_status ||
      "unknown";

    await Order.updateOne(
      { "shipping.sr.awb": awb },
      { $set: { "shipping.sr.lastTracking": data, "shipping.sr.status": String(status) } }
    );

    res.json({ ok: true, data });
  } catch (e) { next(e); }
};

// Get available couriers
export const srGetCouriers = async (req, res, next) => {
  try {
    const { data } = await sr("get", "/courier", {}, { userId: req.user._id });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
};

// Check serviceability for multiple pincodes
export const srBulkServiceability = async (req, res, next) => {
  try {
    const { data } = await sr("post", "/courier/serviceability/", { data: req.body }, { userId: req.user._id });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
};

// Cancel shipment
export const srCancelShipment = async (req, res, next) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { orderIds = [] } = req.body || {};
    if (!orderIds.length) return res.status(400).json({ ok: false, error: "orderIds required" });

    const orders = await Order.find({
      _id: { $in: orderIds },
      "shipping.sr.shipmentId": { $exists: true, $ne: null }
    }).lean();

    const results = [];
    for (const o of orders) {
      try {
        const payload = { shipment_id: o.shipping.sr.shipmentId };
        const { data } = await sr("post", "/orders/cancel", { data: payload }, { userId });

        await Order.updateOne(
          { _id: o._id },
          {
            $set: {
              "shipping.sr.status": "cancelled",
              "shipping.sr.canceledAt": new Date(),
              "shipping.sr.cancelResponse": data
            }
          }
        );

        results.push({ id: o._id, ok: true, data });
      } catch (e) {
        results.push({ id: o._id, ok: false, error: e.response?.data || e.message });
      }
    }

    res.json({ ok: true, results });
  } catch (e) { next(e); }
};

// Update shipment tracking webhook
export const srUpdateWebhook = async (req, res, next) => {
  try {
    const { data } = await sr("post", "/settings/webhook", { data: req.body }, { userId: req.user._id });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
};

// Get shipment details
export const srShipmentDetails = async (req, res, next) => {
  try {
    const { shipment_id } = req.params;
    const { data } = await sr("get", `/shipments/${shipment_id}`, {}, { userId: req.user._id });
    res.json({ ok: true, data });
  } catch (e) { next(e); }
};