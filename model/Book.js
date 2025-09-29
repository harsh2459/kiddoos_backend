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
    coverUrl: [String],        // /public/uploads/xxx.jpg or CDN
    samplePdfUrl: String
  },

  categories: [{ type: String, index: true }],
  tags: [{ type: String, index: true }],

  descriptionHtml: String,
  visibility: { type: String, enum: ["public", "draft"], default: "public" }
}, { timestamps: true });

BookSchema.index({ title: "text", authors: "text", tags: "text" });
export default mongoose.model("Book", BookSchema);
