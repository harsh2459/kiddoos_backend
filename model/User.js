// backend/model/User.js
import mongoose from "mongoose";

const ShiprocketProfileSchema = new mongoose.Schema({
  label: { type: String, required: true },          // "Main SR", "Warehouse-2"
  email: { type: String, required: true },          // SR API user email
  passwordEnc: { type: String, required: true },    // encrypted (we already have encrypt/decrypt utilities)
  pickupLocation: { type: String, default: "Default" },
  defaults: {
    weight: { type: Number, default: 0.5 },
    length: { type: Number, default: 20 },
    breadth:{ type: Number, default: 15 },
    height: { type: Number, default: 3 }
  },
  auth: {
    token: String,
    expiresAt: Date
  },
  active: { type: Boolean, default: false }         // only ONE should be active
}, { _id: true, timestamps: true });

const UserSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true, sparse: true },
  passwordHash: String,
  role: { type: String, enum: ["admin","editor","customer"], default: "admin" },
  isActive: { type: Boolean, default: true },

  // keep old single-integration for backward compat (optional)
  integrations: {
    shiprocket: {
      // legacy fields can remain if you want; new code uses profiles[]
      profiles: [ShiprocketProfileSchema]
    }
  }
}, { timestamps: true });

export default mongoose.model("User", UserSchema);
