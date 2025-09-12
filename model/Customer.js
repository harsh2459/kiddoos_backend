// backend/model/Customer.js
import mongoose from "mongoose";

const { Schema } = mongoose;
const Mixed = Schema.Types.Mixed;

/* ----------------------------------
   Sub-schemas
----------------------------------- */

const AddressSchema = new Schema(
  {
    label: { type: String, default: "Home" }, // Home, Office, etc.
    name: String,
    phone: String,
    email: String,
    address: String,
    city: String,
    state: String,
    pincode: String,
    country: { type: String, default: "IN" },
    isDefault: { type: Boolean, default: false },
  },
  { _id: true, timestamps: true }
);

// Keep price snapshot so cart UI stays stable even if catalog price changes
const CartItemSchema = new Schema(
  {
    bookId: { type: Schema.Types.ObjectId, ref: "Book", required: true, index: true },
    qty: { type: Number, required: true, min: 1 },
    unitPriceSnapshot: { type: Number, required: true },
    meta: Mixed,
    addedAt: { type: Date, default: Date.now, index: true },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const AbandonedCartSchema = new Schema(
  {
    active: { type: Boolean, default: false },      // program running?
    startedAt: { type: Date },                      // when program started
    lastActivityAt: { type: Date },                 // last cart add/remove/qty change
    sendCount: { type: Number, default: 0 },        // emails sent so far
    lastSentAt: { type: Date, default: null },
    nextSendAt: { type: Date, default: null },      // schedule for daily sends
    completed: { type: Boolean, default: false },   // true after 7 sends or cart cleared
    logs: [
      new Schema(
        {
          at: { type: Date, default: Date.now },
          event: {
            type: String,
            enum: ["start", "send", "skip", "complete", "reset", "cancel"],
            required: true,
          },
          note: String,
          meta: Mixed,
        },
        { _id: false }
      ),
    ],
  },
  { _id: false }
);

/* ----------------------------------
   Customer schema (separate from Admin User)
----------------------------------- */

const CustomerSchema = new Schema(
  {
    // Identity
    name: { type: String, trim: true },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      index: true,
      unique: true,
      sparse: true,
    },
    phone: { type: String, index: true, unique: true, sparse: true },

    // Auth (hash only; never store plain)
    passwordHash: { type: String, required: true },
    emailVerifiedAt: { type: Date, default: null },
    phoneVerifiedAt: { type: Date, default: null },

    // Addresses
    addresses: { type: [AddressSchema], default: [] },

    // Cart
    cart: {
      items: { type: [CartItemSchema], default: [] },
      totals: {
        subTotal: { type: Number, default: 0 },
        taxAmount: { type: Number, default: 0 },
        shippingAmount: { type: Number, default: 0 },
        grandTotal: { type: Number, default: 0 },
      },
      lastActivityAt: { type: Date, default: null },     // for abandonment logic
      // Optional: a global expiry marker; controller/cron can use this
      expiresAt: { type: Date, default: null },          // e.g., lastActivity + 7 days
    },

    // Abandoned-cart reminder program
    abandoned: AbandonedCartSchema,

    // Preferences
    preferences: {
      marketingEmails: { type: Boolean, default: true },
      cartReminders:   { type: Boolean, default: true },
    },

    // Recovery / verification tokens (optional)
    tokens: {
      emailVerifyToken: String,
      emailVerifyTokenExpiresAt: Date,
      passwordResetToken: String,
      passwordResetExpiresAt: Date,
      phoneOtp: String,
      phoneOtpExpiresAt: Date,
    },
  },
  { timestamps: true }
);

/* ----------------------------------
   Indexes
----------------------------------- */

CustomerSchema.index({ createdAt: -1 });
CustomerSchema.index({
  "abandoned.active": 1,
  "abandoned.completed": 1,
  "abandoned.nextSendAt": 1,
});
CustomerSchema.index({ "cart.lastActivityAt": -1 });

/* ----------------------------------
   Methods (used by controllers/cron)
----------------------------------- */

CustomerSchema.methods.recalculateCartTotals = function () {
  const sub = (this.cart.items || []).reduce(
    (sum, it) => sum + (Number(it.unitPriceSnapshot || 0) * Number(it.qty || 0)),
    0
  );
  this.cart.totals.subTotal = Math.max(0, Math.round(sub));

  const tax = Number(this.cart.totals.taxAmount || 0);
  const ship = Number(this.cart.totals.shippingAmount || 0);
  this.cart.totals.grandTotal = Math.max(0, Math.round(sub + tax + ship));

  return this.cart.totals;
};

CustomerSchema.methods.touchCartActivity = function (note = "activity") {
  const now = new Date();
  this.cart.lastActivityAt = now;

  // refresh item-level updatedAt
  (this.cart.items || []).forEach((it) => (it.updatedAt = now));

  // set/refresh 7-day expiry window
  this.cart.expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  if (this.abandoned?.active && !this.abandoned.completed) {
    this.abandoned.lastActivityAt = now;
    this.abandoned.logs = this.abandoned.logs || [];
    this.abandoned.logs.push({ event: "skip", note: `cart ${note}`, at: now });
  }
  return now;
};

CustomerSchema.methods.startAbandonedProgramIfNeeded = function () {
  const hasItems = (this.cart.items || []).length > 0;
  if (!hasItems) return false;
  if (!this.preferences?.cartReminders) return false;

  // If already active/not completed, do nothing.
  if (this.abandoned?.active && !this.abandoned.completed) return false;

  const now = new Date();
  this.abandoned = this.abandoned || {};
  this.abandoned.active = true;
  this.abandoned.completed = false;
  this.abandoned.startedAt = now;
  this.abandoned.lastActivityAt = this.cart.lastActivityAt || now;
  this.abandoned.sendCount = 0;
  this.abandoned.lastSentAt = null;

  // IMPORTANT CHANGE: send the first email *today* (cron will pick it up)
  this.abandoned.nextSendAt = now;

  this.abandoned.logs = this.abandoned.logs || [];
  this.abandoned.logs.push({ event: "start", note: "program started", at: now });

  // Ensure a 7-day expiry window exists
  if (!this.cart.expiresAt) {
    this.cart.expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  }
  return true;
};


CustomerSchema.methods.recordAbandonedReminderSent = function () {
  if (!this.abandoned?.active || this.abandoned.completed) return false;

  const now = new Date();
  this.abandoned.sendCount = (this.abandoned.sendCount || 0) + 1;
  this.abandoned.lastSentAt = now;

  if (this.abandoned.sendCount >= 7) {
    this.abandoned.completed = true;
    this.abandoned.nextSendAt = null;
    this.abandoned.logs.push({ event: "complete", note: "7 emails sent", at: now });
  } else {
    this.abandoned.nextSendAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    this.abandoned.logs.push({ event: "send", note: `email #${this.abandoned.sendCount}`, at: now });
  }
  return true;
};

CustomerSchema.methods.resetAbandonedProgram = function (reason = "reset") {
  if (!this.abandoned) this.abandoned = {};
  const now = new Date();
  this.abandoned.active = false;
  this.abandoned.completed = true;
  this.abandoned.nextSendAt = null;
  this.abandoned.logs = this.abandoned.logs || [];
  this.abandoned.logs.push({ event: "cancel", note: reason, at: now });
  return true;
};

export default mongoose.model("Customer", CustomerSchema);
