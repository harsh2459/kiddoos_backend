import mongoose from "mongoose";
const Schema = mongoose.Schema;

const PaymentSchema = new Schema({
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
  paymentType: { type: String, enum: ['full_online', 'half_online_half_cod'], required: true },
  provider: { type: String, default: 'razorpay' },
  providerOrderId: { type: String },
  providerPaymentId: { type: String },
  status: { type: String, enum: ['created', 'pending', 'partially_paid', 'paid', 'failed'], default: 'created' },
  paidAmount: { type: Number, default: 0 },
  pendingAmount: { type: Number, default: 0 },
  currency: { type: String, default: 'INR' },
  createdAt: { type: Date, default: Date.now },
  paidAt: { type: Date },
  verifiedAt: { type: Date },
  rawResponse: { type: Object },
});

const Payment = mongoose.model("Payment", PaymentSchema);
export default Payment;
