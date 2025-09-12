import mongoose from "mongoose";
const { Schema } = mongoose;

/**
 * Mail sending profiles that admins can add in the dashboard.
 * Supports Gmail and generic SMTP.
 *
 * type:
 *  - "gmail": uses nodemailer { service: "gmail", auth.user, auth.pass }
 *  - "smtp":  uses host/port/secure + auth.user/pass
 */
const MailSenderSchema = new Schema(
  {
    label:     { type: String, required: true },   // e.g., "Main Gmail", "Marketing SMTP"
    type:      { type: String, enum: ["gmail", "smtp"], default: "gmail" },

    // common
    fromEmail: { type: String, required: true },   // what recipients see
    fromName:  { type: String, default: "" },

    // auth (store securely in production; plain for speed here)
    user:      { type: String, required: true },   // Gmail/SMTP username
    pass:      { type: String, required: true },   // Gmail App Password or SMTP password

    // SMTP-only fields
    host:      { type: String },                   // e.g., smtp.gmail.com OR provider
    port:      { type: Number, default: 587 },
    secure:    { type: Boolean, default: false },  // true = port 465

    isActive:  { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("MailSender", MailSenderSchema);
