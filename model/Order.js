// backend/model/Order.js
import mongoose from "mongoose";

const Mixed = mongoose.Schema.Types.Mixed;

const SrLogSchema = new mongoose.Schema({
  type: String,                 // e.g., "orders.create.adhoc", "courier.generate.label"
  at:   { type: Date, default: Date.now },
  request:  Mixed,
  response: Mixed,
  error:    String
}, { _id: false });

const OrderSchema = new mongoose.Schema({
  userId: { type: mongoose.Types.ObjectId, ref: "User" },

  items: [{
    bookId:    { type: mongoose.Types.ObjectId, ref: "Book", required: true },
    qty:       { type: Number, required: true },
    unitPrice: { type: Number, required: true }
  }],

  amount:         { type: Number, required: true },
  taxAmount:      { type: Number, default: 0 },
  shippingAmount: { type: Number, default: 0 },
  couponId:       { type: mongoose.Types.ObjectId, ref: "Coupon" },

  payment: {
    provider: { type: String, default: "razorpay" },
    status:   { type: String, enum: ["pending", "paid", "failed"], default: "pending" },
    orderId:  String,   // Razorpay order id
    paymentId:String,   // Razorpay payment id
    signature:String
  },

  email:   String,
  phone:   String,

  // (legacy/optional) keep if your checkout still posts this blob
  shippingAddress: Object,

  status: { type: String, enum: ["pending", "paid", "shipped", "delivered", "refunded"], default: "pending" },

  shipping: {
    name: String, phone: String, email: String,
    address: String, city: String, state: String, pincode: String, country: String,

    // parcel dimensions
    weight: Number, length: Number, breadth: Number, height: Number,

    // Don't use enum with null; Mongoose enum + null can be quirky.
    provider: { type: String, default: null }, // e.g., "shiprocket"

    sr: {
      // IDs from Shiprocket
      orderId:    String,                     // SR order_id
      shipmentId: { type: String, index: true },

      // Fulfilment bits
      awb:        { type: String, index: true },
      courier:    String,
      pickupScheduledAt: Date,

      // Docs
      labelUrl:    String,
      manifestUrl: String,
      invoiceUrl:  String,

      // Tracking/status
      status:       String,                   // last known SR status (e.g. from webhook/track)
      lastTracking: Mixed,                    // full payload from /track

      // Creation bookkeeping
      createStatus: { type: String, enum: ["created", "failed"], default: undefined },
      createError:  mongoose.Schema.Types.Mixed,
      lastCreateResp:   Mixed,

      // Last responses for ops (handy for debugging)
      lastLabelResp:    Mixed,
      lastManifestResp: Mixed,
      lastInvoiceResp:  Mixed,
      lastPickupResp:   Mixed,
      cancelResponse:   Mixed,

      // Full audit trail of all SR calls
      logs: [SrLogSchema]
    }
  }
}, { timestamps: true });

// Helpful indexes
OrderSchema.index({ createdAt: -1 });
OrderSchema.index({ status: 1, createdAt: -1 });
OrderSchema.index({ "shipping.sr.shipmentId": 1 });
OrderSchema.index({ "shipping.sr.awb": 1 });

export default mongoose.model("Order", OrderSchema);
