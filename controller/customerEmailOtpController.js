// backend/controller/customerEmailOtpController.js
import jwt from "jsonwebtoken";
import EmailOTP from "../model/EmailOTP.js";
import { sendBySlug, sendWithSender } from "../utils/mailer.js";

const TICKET_SECRET = process.env.EMAIL_OTP_JWT_SECRET || "dev_email_otp_secret";
const TICKET_TTL_MIN = Number(process.env.EMAIL_OTP_TICKET_TTL_MIN || 15);
const OTP_TTL_MIN = Number(process.env.EMAIL_OTP_TTL_MIN || 10);
const MAX_ATTEMPTS = Number(process.env.EMAIL_OTP_MAX_ATTEMPTS || 5);
const MAX_RESENDS  = Number(process.env.EMAIL_OTP_MAX_RESENDS  || 3);
const RESEND_GAP_S = Number(process.env.EMAIL_OTP_RESEND_GAP_S || 45);

// utility
const randOTP = () => Math.floor(100000 + Math.random()*900000); // 6 digits

export const startEmailOtp = async (req, res) => {
  try {
    let { email } = req.body || {};
    email = (email || "").toLowerCase().trim();
    if (!email) return res.status(400).json({ error: "Email required" });

    const now = new Date();
    const otp = String(randOTP());
    const salt = Math.random().toString(36).slice(2, 10);
    const otpHash = EmailOTP.hashOtp(otp, salt);
    const expiresAt = new Date(now.getTime() + OTP_TTL_MIN*60*1000);

    let doc = await EmailOTP.findOne({ email });
    if (doc) {
      // basic resend throttling
      if (doc.sentCount >= MAX_RESENDS && (!doc.verifiedAt)) {
        return res.status(429).json({ error: "Too many resends. Try later." });
      }
      if (doc.lastSentAt && (now - doc.lastSentAt) < RESEND_GAP_S*1000) {
        return res.status(429).json({ error: "Please wait a bit before resending." });
      }
      doc.otpHash = otpHash;
      doc.salt = salt;
      doc.expiresAt = expiresAt;
      doc.lastSentAt = now;
      doc.sentCount = (doc.sentCount || 0) + 1;
      doc.attempts = 0;
      doc.verifiedAt = null;
      await doc.save();
    } else {
      doc = await EmailOTP.create({ email, otpHash, salt, expiresAt, lastSentAt: now });
    }

    // Send email via template "verify_email_otp" if present; else basic send
    const ctx = { email, otp, minutes: OTP_TTL_MIN };
    try {
      await sendBySlug("verify_email_otp", email, ctx, {});
    } catch {
      const fallbackSenderId = process.env.EMAIL_OTP_SENDER_ID; // optional
      const subject = `Your verification code: ${otp}`;
      const text = `Your verification code is ${otp}. It expires in ${OTP_TTL_MIN} minutes.`;
      const html = `<p>Your verification code is <b>${otp}</b>.</p><p>It expires in ${OTP_TTL_MIN} minutes.</p>`;
      if (fallbackSenderId) {
        await sendWithSender(fallbackSenderId, { to: email, subject, text, html });
      } else {
        // if no sender configured, still OK to respond; devs can check logs
        console.log("[EMAIL OTP] dev mode OTP for", email, "=>", otp);
      }
    }

    return res.json({ ok: true, expireInSec: OTP_TTL_MIN*60 });
  } catch (e) {
    console.error("startEmailOtp:", e);
    return res.status(500).json({ error: "Failed to send OTP" });
  }
};

export const verifyEmailOtp = async (req, res) => {
  try {
    let { email, otp } = req.body || {};
    email = (email || "").toLowerCase().trim();
    otp = String(otp || "").trim();
    if (!email || !otp) return res.status(400).json({ error: "Email & OTP required" });

    const doc = await EmailOTP.findOne({ email });
    if (!doc) return res.status(404).json({ error: "No OTP issued for this email" });

    if (doc.verifiedAt) {
      // already verified recently—issue a fresh ticket
      const token = jwt.sign({ email }, TICKET_SECRET, { expiresIn: `${TICKET_TTL_MIN}m` });
      return res.json({ ok: true, ticket: token, alreadyVerified: true });
    }

    if (doc.attempts >= MAX_ATTEMPTS)
      return res.status(429).json({ error: "Too many attempts, request a new OTP" });

    if (doc.expiresAt < new Date())
      return res.status(410).json({ error: "OTP expired, request a new one" });

    const hash = EmailOTP.hashOtp(otp, doc.salt);
    if (hash !== doc.otpHash) {
      doc.attempts += 1;
      await doc.save();
      return res.status(400).json({ error: "Incorrect OTP" });
    }

    // mark verified and issue short-lived ticket for signup
    doc.verifiedAt = new Date();
    await doc.save();

    const token = jwt.sign({ email }, TICKET_SECRET, { expiresIn: `${TICKET_TTL_MIN}m` });
    return res.json({ ok: true, ticket: token });
  } catch (e) {
    console.error("verifyEmailOtp:", e);
    return res.status(500).json({ error: "Verification failed" });
  }
};
