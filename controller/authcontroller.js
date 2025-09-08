import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../model/User.js";


// Is there any admin in the system?
export const hasAdmin = async (req, res) => {
  const count = await User.countDocuments({ role: "admin", isActive: true });
  res.json({ ok: true, hasAdmin: count > 0 });
};

// First-time setup: allow creating the very first admin from UI
export const registerFirstAdmin = async (req, res) => {
  const hasOne = await User.exists({ role: "admin", isActive: true });
  if (hasOne) return res.status(403).json({ ok: false, error: "Admin already exists" });

  const { name, email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ ok: false, error: "email and password required" });
  if (password.length < 8) return res.status(400).json({ ok: false, error: "password too short" });

  const existing = await User.findOne({ email });
  if (existing) return res.status(400).json({ ok: false, error: "Email already used" });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({ name, email, passwordHash, role: "admin", isActive: true });

  const token = jwt.sign({ id: user._id, role: user.role, email: user.email }, process.env.JWT_SECRET, { expiresIn: "7d" });
  res.json({ ok: true, token, role: user.role });
};

// Existing admin can create more admins
export const createAdmin = async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password) return res.status(400).json({ ok:false, error:"email and password required" });
  const exists = await User.findOne({ email });
  if (exists) return res.status(400).json({ ok:false, error:"User already exists" });
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({ email, passwordHash, name, role: "admin", isActive: true });
  res.json({ ok:true, userId: user._id });
};


export const seedAdmin = async (req, res) => {
  // quick helper to create first admin
  const { email, password, name } = req.body;
  const exists = await User.findOne({ email });
  if (exists) return res.json({ ok:true, message: "Admin exists" });
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({ email, passwordHash, name, role: "admin" });
  res.json({ ok:true, userId: user._id });
};

export const login = async (req, res) => {
  const { email, password } = req.body || {};
  const user = await User.findOne({ email, isActive: true });
  if (!user) return res.status(401).json({ ok: false, error: "Invalid credentials" });
  const ok = await bcrypt.compare(password, user.passwordHash || "");
  if (!ok) return res.status(401).json({ ok: false, error: "Invalid credentials" });

  const token = jwt.sign({ id: user._id, role: user.role, email: user.email }, process.env.JWT_SECRET, { expiresIn: "7d" });
  res.json({ ok: true, token, role: user.role });
};
