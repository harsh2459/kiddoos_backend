// controller/_services/srOrders.helper.js
import User from "../../model/User.js";
import Order from "../../model/Order.js";
import { sr } from "./shiprocket.js";

export async function findSrOwnerUserId() {
  const u = await User.findOne({
    role: "admin",
    "integrations.shiprocket.profiles.active": true
  }).select("_id").lean();
  if (!u?._id) throw new Error("No admin with an active Shiprocket profile.");
  return u._id;
}

async function activeProfile(userId) {
  const u = await User.findById(userId).select("integrations.shiprocket.profiles").lean();
  const list = u?.integrations?.shiprocket?.profiles || [];
  return list.find(p => p.active) || null;
}

async function pickupLocationFor(userId) {
  const p = await activeProfile(userId);
  return p?.pickupLocation || process.env.SR_PICKUP_LOCATION || "Default";
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

// small logger so you store every SR response on the order
async function logSR(orderId, type, reqPayload, resPayload, error) {
  await Order.updateOne(
    { _id: orderId },
    {
      $push: {
        "shipping.sr.logs": {
          type, at: new Date(),
          request: reqPayload ?? null,
          response: resPayload ?? null,
          error: error ? String(error?.message || error) : null
        }
      }
    }
  );
}

/** Create Shiprocket order for a single Local Order */
export async function createSrForOrder(orderId, ownerUserId) {
  const userId = ownerUserId;
  const o = await Order.findById(orderId).lean();
  if (!o) throw new Error("Order not found");
  if (o?.shipping?.sr?.shipmentId) return { skipped: true, reason: "already_created" };

  const ship = o.shipping || {};
  const required = ["address", "city", "state", "pincode", "phone"];
  const missing = required.filter(k => !String(ship[k] || "").trim());
  if (missing.length) throw new Error("Missing shipping fields: " + missing.join(", "));

  const order_items = (o.items || []).map(it => ({
    name: it.title || it.name || "Item",
    sku: it.inventory?.sku || it.sku || String(it.bookId || it._id || "SKU"),
    units: Number(it.qty || 1),
    selling_price: Number(it.unitPrice ?? it.price ?? 0),
    discount: 0,
    tax: Number(it.tax || 0)
  }));
  const sub_total = order_items.reduce((s, it) => s + it.selling_price * it.units, 0);

  const { weight, length, breadth, height } = await dimsFor(userId, o);
  const pickup_location = await pickupLocationFor(userId);
  const payment_method = (o.payment?.status === "paid") ? "Prepaid" : "COD";

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
    const { data } = await sr("post", "/orders/create/adhoc", { data: payload }, { userId });

    const srOrderId =
      data?.order_id ?? data?.orderId ?? data?.response?.order_id ?? data?.data?.order_id ?? "";
    const srShipmentId =
      data?.shipment_id ?? data?.shipmentId ?? data?.response?.shipment_id ?? data?.data?.shipment_id ?? "";

    await Order.updateOne(
      { _id: o._id },
      {
        $set: {
          "shipping.provider": "shiprocket",
          "shipping.sr.orderId": String(srOrderId),
          "shipping.sr.shipmentId": String(srShipmentId),
          "shipping.sr.createStatus": "created",
          "shipping.sr.createAt": new Date(),
          "shipping.sr.lastCreateResp": data
        }
      }
    );
    await logSR(o._id, "orders.create.adhoc", payload, data, null);
    return { created: true, orderId: srOrderId, shipmentId: srShipmentId };
    
  } catch (e) {
    await Order.updateOne(
      { _id: o._id },
      { $set: { "shipping.sr.createStatus": "failed", "shipping.sr.createError": e.response?.data || e.message } }
    );
    await logSR(o._id, "orders.create.adhoc", payload, e.response?.data, e);
    throw e;
  }
}
