import crypto from "crypto";

const key = crypto.createHash("sha256")
  .update(process.env.JWT_SECRET || "catalogue_secret")
  .digest(); // 32 bytes for aes-256
const ivBytes = 16;

export function encrypt(text = "") {
  const iv = crypto.randomBytes(ivBytes);
  const cipher = crypto.createCipheriv("aes-256-ctr", key, iv);
  const enc = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return iv.toString("hex") + ":" + enc.toString("hex");
}

export function decrypt(payload = "") {
  if (!payload || !payload.includes(":")) return "";
  const [ivHex, encHex] = payload.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const enc = Buffer.from(encHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-ctr", key, iv);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}
