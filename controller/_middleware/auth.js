import jwt from "jsonwebtoken";

export const requireAuth = (roles = ["admin"]) => (req, res, next) => {
  try {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    if (!token) return res.status(401).json({ ok:false, error:"Unauthorized" });

    const data = jwt.verify(token, process.env.JWT_SECRET); // { id, role, email }
    if (roles.length && !roles.includes(data.role)) {
      return res.status(403).json({ ok:false, error:"Forbidden" });
    }

    req.user = { ...data, _id: data.id };  // <-- add _id mirror
    next();
  } catch (e) {
    return res.status(401).json({ ok:false, error:"Invalid token" });
  }
};

export const optionalAuth = (req, _res, next) => {
  const h = req.headers.authorization || "";
  if (h.startsWith("Bearer ")) {
    const token = h.split(" ")[1];
    try {
      const dec = jwt.verify(token, process.env.JWT_SECRET);
      req.user = { id: dec.id, _id: dec.id, role: dec.role, email: dec.email }; // <-- add _id mirror
    } catch { /* ignore */ }
  }
  next();
};