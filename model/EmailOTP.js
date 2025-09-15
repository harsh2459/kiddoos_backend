// backend/model/EmailOTP.js
import mongoose from "mongoose";
import crypto from "crypto";

const { Schema } = mongoose;

const EmailOTPSchema = new Schema({
  email: { type: String, required: true, lowercase: true, index: true, unique: true },
  // sha256(otp + salt)
  otpHash: { type: String, required: true },
  salt: { type: String, required: true },
  expiresAt: { type: Date, required: true, index: true },
  attempts: { type: Number, default: 0 },       // compare attempts
  sentCount: { type: Number, default: 1 },      // how many times sent
  lastSentAt: { type: Date, default: Date.now },
  verifiedAt: { type: Date, default: null },    // if verified, set timestamp
}, { timestamps: true });

EmailOTPSchema.index({ email: 1 });
EmailOTPSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // auto cleanup at expiry

EmailOTPSchema.statics.hashOtp = function (otp, salt) {
  return crypto.createHash("sha256").update(String(otp) + String(salt)).digest("hex");
};

export default mongoose.model("EmailOTP", EmailOTPSchema);
