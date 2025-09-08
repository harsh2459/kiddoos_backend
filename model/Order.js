import mongoose from "mongoose";

const OrderSchema = new mongoose.Schema({
  userId: { type: mongoose.Types.ObjectId, ref: "User" },
  items: [{
    bookId: { type: mongoose.Types.ObjectId, ref: "Book", required: true },
    qty: { type: Number, required: true },
    unitPrice: { type: Number, required: true }
  }],
  amount: { type: Number, required: true },
  taxAmount: { type: Number, default: 0 },
  shippingAmount: { type: Number, default: 0 },
  couponId: { type: mongoose.Types.ObjectId, ref: "Coupon" },

  payment: {
    provider: { type: String, default: "razorpay" },
    status: { type: String, enum: ["pending","paid","failed"], default: "pending" },
    orderId: String,      // Razorpay order id
    paymentId: String,    // Razorpay payment id
    signature: String
  },

  email: String,
  phone: String,
  shippingAddress: Object,
  status: { type: String, enum: ["pending","paid","shipped","delivered","refunded"], default: "pending" }
}, { timestamps: true });

export default mongoose.model("Order", OrderSchema);
