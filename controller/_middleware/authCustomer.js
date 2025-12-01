import jwt from "jsonwebtoken";

// ✅ Must match customerController.js
const JWT_SECRET = process.env.JWT_SECRET || "qwertyuioplkjhgfdsazxcvbnm12345678980jfghawfhuqy498554rf3445yt4g5426gt456654y7984gv65864984y16654y98645656465454654465rd14vg68f4165vg14df61g65df4g6514df65g4df65g16df4g6df1g6df4g4";


export default function authCustomer(req, res, next) {
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
  
  if (!token) {
    console.error("❌ [authCustomer] No token provided for:", req.method, req.originalUrl);
    return res.status(401).json({ error: "Auth required" });
  }
  
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.customerId = payload.cid;
    console.log("✅ [authCustomer] Token verified for customer:", payload.cid);
    next();
  } catch (err) {
    console.error("❌ [authCustomer] JWT verification failed:", err.message);
    console.error("   Token (first 30 chars):", token.substring(0, 30) + "...");
    console.error("   URL:", req.originalUrl);
    return res.status(401).json({ error: "Invalid token", details: err.message });
  }
}
