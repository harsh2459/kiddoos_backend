// backend/model/Order.js
import mongoose from "mongoose";

const { Schema } = mongoose;
const Mixed = Schema.Types.Mixed;

const SrLogSchema = new Schema({
  type: String,                 // e.g., "orders.create.adhoc", "courier.generate.label"
  at:   { type: Date, default: Date.now },
  request:  Mixed,
  response: Mixed,
  error:    String
}, { _id: false });

/** Track every monetary movement linked to the order */
const TxnSchema = new Schema({
  kind: { type: String, enum: ["prepaid", "cod", "refund"], required: true },
  provider: { type: String, default: "razorpay" }, // or "shiprocket" for COD settlement, etc.
  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, default: "INR" },
  at: { type: Date, default: Date.now },

  // Provider references
  orderId:  String,   // e.g., Razorpay order id
  paymentId:String,   // e.g., Razorpay payment id
  signature:String,   // e.g., Razorpay signature
  reference:String,   // any extra reference (SR AWB, settlement ref, UTR, etc.)

  status: { type: String, enum: ["pending", "captured", "failed", "refunded"], default: "captured" },
  meta: Mixed
}, { _id: true });

const OrderSchema = new Schema({
  userId: { type: mongoose.Types.ObjectId, ref: "Customer" }, // point to Customer

  items: [{
    bookId:    { type: mongoose.Types.ObjectId, ref: "Book", required: true },
    qty:       { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 }
  }],

  amount:         { type: Number, required: true }, // grand total to collect (prepaid + COD)
  taxAmount:      { type: Number, default: 0 },
  shippingAmount: { type: Number, default: 0 },
  couponId:       { type: mongoose.Types.ObjectId, ref: "Coupon" },

  /** Payment summary + mode */
  payment: {
    provider: { type: String, default: "razorpay" },
    mode:     { type: String, enum: ["full", "half"], default: "full" }, // NEW

    status:   { type: String, enum: ["pending", "paid", "failed"], default: "pending" },
    orderId:  String,
    paymentId:String,
    signature:String,

    // Running totals (derived/maintained by controllers)
    paidAmount:          { type: Number, default: 0 }, // prepaid + settled COD collected
    dueAmount:           { type: Number, default: 0 }, // amount - paidAmount
    dueOnDeliveryAmount: { type: Number, default: 0 }, // for half mode (COD amount)
    // Whether COD half has been collected/settled back to you
    codSettlementStatus: { type: String, enum: ["na", "pending", "settled"], default: "na" }
  },

  // Detailed transaction ledger (prepaid, COD, refunds)
  transactions: { type: [TxnSchema], default: [] },

  email:   String,
  phone:   String,
  shippingAddress: Object, // legacy/optional

  status: { type: String, enum: ["pending", "paid", "shipped", "delivered", "refunded"], default: "pending" },

  shipping: {
    name: String, phone: String, email: String,
    address: String, city: String, state: String, pincode: String, country: String,

    // parcel dimensions
    weight: Number, length: Number, breadth: Number, height: Number,

    provider: { type: String, default: null }, // e.g., "shiprocket"

    bd: {
      orderId:    String,                     // BD order_id
      shipmentId: { type: String, index: true },
      awb:        { type: String, index: true },
      courier:    String,
      pickupScheduledAt: Date,

      // Docs
      labelUrl:    String,
      manifestUrl: String,
      invoiceUrl:  String,

      // Tracking/status
      status:       String,
      lastTracking: Mixed,

      // Creation bookkeeping
      createStatus: { type: String, enum: ["created", "failed"], default: undefined },
      createError:  Schema.Types.Mixed,
      lastCreateResp:   Mixed,

      lastLabelResp:    Mixed,
      lastManifestResp: Mixed,
      lastInvoiceResp:  Mixed,
      lastPickupResp:   Mixed,
      cancelResponse:   Mixed,

      // When using half payment, SR needs COD amount for collection
      codAmount: { type: Number, default: 0 }, // NEW: pass to SR if mode === "half"

      logs: [SrLogSchema]
    }
  }
}, { timestamps: true });

/* Indexes */
OrderSchema.index({ createdAt: -1 });
OrderSchema.index({ status: 1, createdAt: -1 });
OrderSchema.index({ "shipping.sr.shipmentId": 1 });
OrderSchema.index({ "shipping.sr.awb": 1 });

/* Helper methods */
OrderSchema.methods.applyPaymentMode = function(mode = "full") {
  this.payment.mode = mode;
  if (mode === "full") {
    this.payment.dueOnDeliveryAmount = 0;
    this.payment.codSettlementStatus = "na";
  } else if (mode === "half") {
    // Round as per your policy (here: math round to nearest rupee)
    const half = Math.round(this.amount / 2);
    this.payment.dueOnDeliveryAmount = this.amount - half; // collect on delivery
    this.shipping = this.shipping || {};
    this.shipping.sr = this.shipping.sr || {};
    this.shipping.sr.codAmount = this.payment.dueOnDeliveryAmount;
    this.payment.codSettlementStatus = "pending";
  }
  this.recomputeDue();
  return this;
};

OrderSchema.methods.addTransaction = function(txn) {
  // txn: {kind, provider, amount, orderId, paymentId, signature, reference, status}
  this.transactions.push(txn);

  // Update rollups
  if (txn.kind === "prepaid" && txn.status !== "failed") {
    this.payment.paidAmount += Number(txn.amount || 0);
  }
  if (txn.kind === "cod" && txn.status === "captured") {
    this.payment.paidAmount += Number(txn.amount || 0);
    this.payment.codSettlementStatus = "settled";
  }
  if (txn.kind === "refund" && txn.status === "refunded") {
    this.payment.paidAmount -= Number(txn.amount || 0);
  }

  this.recomputeDue();
  return this;
};

OrderSchema.methods.recomputeDue = function() {
  const total = Number(this.amount || 0);
  const paid  = Math.max(0, Number(this.payment.paidAmount || 0));
  this.payment.dueAmount = Math.max(0, total - paid);

  // If fully covered prepaid in "full" mode → mark paid
  if (this.payment.mode === "full") {
    this.payment.status = this.payment.dueAmount === 0 ? "paid" : "pending";
  }

  // In "half" mode:
  // - after prepaid half is captured, status can stay "pending" until COD collected,
  //   or you can flip to a custom status in controllers (e.g., "part-paid")
  // Here we keep standard statuses and let controller manage business rules.
  return this.payment;
};

export default mongoose.model("Order", OrderSchema);
