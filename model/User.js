import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true, sparse: true },
  passwordHash: String,
  role: { type: String, enum: ["admin","editor","customer"], default: "admin" },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

export default mongoose.model("User", UserSchema);
