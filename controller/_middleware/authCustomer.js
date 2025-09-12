import jwt from "jsonwebtoken";
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

export default function authCustomer(req, res, next) {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Auth required" });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.customerId = payload.cid;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}
