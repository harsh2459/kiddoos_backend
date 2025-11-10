// model/Order.js

import mongoose from "mongoose";

const { Schema } = mongoose;

const Mixed = Schema.Types.Mixed;

const BdLogSchema = new Schema({
  type: String,
  at: { type: Date, default: Date.now },
  request: Mixed,
  response: Mixed,
  error: String
}, { _id: false });

const TxnSchema = new Schema({
  kind: { type: String, enum: ["prepaid", "cod", "refund"], required: true },
  provider: { type: String, default: "razorpay" },
  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, default: "INR" },
  at: { type: Date, default: Date.now },
  orderId: String,
  paymentId: String,
  signature: String,
  reference: String,
  status: { type: String, enum: ["pending", "captured", "failed", "refunded"], default: "captured" },
  meta: Mixed
}, { _id: true });

const OrderSchema = new Schema({
  userId: { type: mongoose.Types.ObjectId, ref: "Customer" },
  items: [{
    bookId: { type: mongoose.Types.ObjectId, ref: "Book", required: true },
    qty: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 }
  }],
  amount: { type: Number, required: true },
  taxAmount: { type: Number, default: 0 },
  shippingAmount: { type: Number, default: 0 },
  couponId: { type: mongoose.Types.ObjectId, ref: "Coupon" },
  payment: {
    provider: { type: String, default: "razorpay" },
    mode: { type: String, enum: ["full", "half"], default: "full" },
    paymentType: { type: String, enum: ["full_online", "half_online_half_cod", "full_cod"], default: "full_online" },
    status: { type: String, enum: ["pending", "paid", "failed", "partially_paid"], default: "pending" },
    orderId: String,
    paymentId: String,
    signature: String,
    paidAmount: { type: Number, default: 0 },
    dueAmount: { type: Number, default: 0 },
    dueOnDeliveryAmount: { type: Number, default: 0 },
    codSettlementStatus: { type: String, enum: ["na", "pending", "settled"], default: "na" }
  },
  transactions: { type: [TxnSchema], default: [] },
  email: String,
  phone: String,
  status: {
    type: String,
    enum: ["pending", "confirmed", "paid", "shipped", "delivered", "refunded", "cancelled"],
    default: "pending"
  },
  shipping: {
    name: String,
    phone: String,
    email: String,
    address: String,
    city: String,
    state: String,
    pincode: String,
    country: { type: String, default: "India" },
    weight: Number,
    length: Number,
    breadth: Number,
    height: Number,
    provider: { type: String, default: null },
    bd: {
      profileId: { type: mongoose.Types.ObjectId, ref: "BlueDartProfile" },
      orderId: String,
      awbNumber: { type: String, index: true },
      productCode: { type: String, enum: ["A", "D"], default: "A" },
      courier: String,
      status: String,
      codAmount: { type: Number, default: 0 },
      createdAt: Date,
      pickupScheduledAt: Date,
      pickupStatus: String,
      canceledAt: Date,
      
      // ===== LABEL FIELDS (NEW - for label generation) =====

      labelUrl: String,
      labelFileName: String,
      labelGeneratedAt: Date,
      labelStatus: {
        type: String,
        enum: ["generated", "downloaded", "failed"],
        default: null
      },
      
      // ====================================================
      
      manifestUrl: String,
      invoiceUrl: String,
      lastTracking: Mixed,
      lastTrackedAt: Date,
      createStatus: String,
      createError: Mixed,
      lastCreateResp: Mixed,
      lastLabelResp: Mixed,
      lastManifestResp: Mixed,
      lastPickupResp: Mixed,
      cancelResponse: Mixed,
      logs: [BdLogSchema]
    },
    notes: String
  }
}, { timestamps: true });

// Indexes
OrderSchema.index({ createdAt: -1 });
OrderSchema.index({ status: 1, createdAt: -1 });
OrderSchema.index({ "shipping.bd.awbNumber": 1 });
OrderSchema.index({ userId: 1, createdAt: -1 });

// Helper methods
OrderSchema.methods.applyPaymentMode = function(mode = "full") {
  this.payment.mode = mode;
  if (mode === "full") {
    this.payment.dueOnDeliveryAmount = 0;
    this.payment.codSettlementStatus = "na";
    this.payment.paymentType = "full_online";
  } else if (mode === "half") {
    const half = Math.round(this.amount / 2);
    this.payment.dueOnDeliveryAmount = this.amount - half;
    this.payment.paymentType = "half_online_half_cod";
    this.payment.codSettlementStatus = "pending";
    this.shipping = this.shipping || {};
    this.shipping.bd = this.shipping.bd || {};
    this.shipping.bd.codAmount = this.payment.dueOnDeliveryAmount;
    this.shipping.bd.productCode = "D";
  }
  this.recomputeDue();
  return this;
};

OrderSchema.methods.addTransaction = function(txn) {
  this.transactions.push(txn);
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
  const paid = Math.max(0, Number(this.payment.paidAmount || 0));
  this.payment.dueAmount = Math.max(0, total - paid);
  if (this.payment.mode === "full") {
    this.payment.status = this.payment.dueAmount === 0 ? "paid" : "pending";
  } else if (this.payment.mode === "half") {
    if (paid >= Math.round(total / 2)) {
      this.payment.status = "partially_paid";
    }
  }
  return this.payment;
};

export default mongoose.model("Order", OrderSchema);