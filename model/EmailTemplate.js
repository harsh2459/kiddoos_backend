import mongoose from "mongoose";
const { Schema } = mongoose;

const EmailTemplateSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true },

    category: {
      type: String,
      enum: ["abandoned_cart", "order", "shipping", "marketing", "misc"],
      default: "misc",
      index: true,
    },
    abandonedDay: { type: Number, min: 1, max: 7, default: null, index: true },

    subject: { type: String, required: true },
    html:    { type: String, required: true },
    text:    { type: String },

    isActive: { type: Boolean, default: true },
    description: { type: String },

    // NEW: choose which sender to use
    mailSender: { type: Schema.Types.ObjectId, ref: "MailSender" },

    // Optional overrides (kept for backwards compat)
    fromEmail: { type: String },
    fromName:  { type: String },

    // NEW: default recipients added on each send using this template
    alwaysTo:  [{ type: String }],
    alwaysCc:  [{ type: String }],
    alwaysBcc: [{ type: String }],
  },
  { timestamps: true }
);

export default mongoose.model("EmailTemplate", EmailTemplateSchema);
