import mongoose from "mongoose";

const BookSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, index: "text" },
  slug: { type: String, required: true, unique: true, index: true },
  subtitle: String,
  isbn10: String,
  isbn13: String,
  authors: [{ type: String, index: true }],
  language: { type: String, default: "English" },
  pages: Number,
  edition: String,
  printType: { type: String, enum: ["paperback", "hardcover", "ebook"], default: "paperback" },

  mrp: { type: Number, required: true },
  price: { type: Number, required: true },
  discountPct: { type: Number, default: 0 },
  taxRate: { type: Number, default: 0 },
  currency: { type: String, default: "INR" },
  inventory: {
    sku: { type: String, index: true },
    stock: { type: Number, default: 0 },
    lowStockAlert: { type: Number, default: 5 }
  },

  assets: {
    coverUrl: [String],
    samplePdfUrl: String
  },

  categories: [{ type: String, index: true }],
  tags: [{ type: String, index: true }],

  descriptionHtml: String,
  whyChooseThis: [{
    type: String,
    trim: true
  }],
  suggestions: [{
    type: String,
    trim: true,
    index: true  // Index for fast lookup
  }],

  visibility: { type: String, enum: ["public", "draft"], default: "public" }
}, { timestamps: true });

BookSchema.index({ title: "text", authors: "text", tags: "text", suggestions: 1 },
  {
    default_language: "english",
    // Use a field name that you don't use anywhere to disable override:
    language_override: "__language_override_disabled"
  }
);

export default mongoose.model("Book", BookSchema);
