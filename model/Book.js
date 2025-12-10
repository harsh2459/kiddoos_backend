import mongoose from "mongoose";

const BookSchema = new mongoose.Schema({
  // --- EXISTING FIELDS (DO NOT TOUCH) ---
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
    asin: { type: String, index: true },
    stock: { type: Number, default: 0 },
    lowStockAlert: { type: Number, default: 5 }
  },

  dimensions: {
    weight: { type: Number, default: 0 },
    length: { type: Number, default: 0 },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 }
  },

  assets: {
    coverUrl: [String],
    samplePdfUrl: String
  },

  categories: [{ type: String, index: true }],
  tags: [{ type: String, index: true }],

  descriptionHtml: String,
  whyChooseThis: [{ type: String, trim: true }],
  suggestions: [{ type: String, trim: true, index: true }],

  visibility: { type: String, enum: ["public", "draft"], default: "public" },

  // --- ✅ NEW FIELDS FOR MASTER TEMPLATE ---
  
  // 1. Theme Selector
  templateType: { 
    type: String, 
    enum: ["spiritual", "activity", "standard"], 
    default: "standard" 
  },

  // 2. Dynamic Page Configuration
  layoutConfig: {
    
    // The "Our Story" / Mission Section
    story: {
      heading: { type: String, default: "Why We Created This Book?" },
      text: { type: String }, // The main paragraph
      quote: { type: String }, // The italic quote inside the box
      imageUrl: { type: String } // Specific image for the story section
    },

    // The Curriculum / Skills Grid (The Icons Section)
    curriculum: [{
      title: { type: String },       // e.g., "Cognitive Skills"
      description: { type: String }, // e.g., "Enhances memory..."
      icon: { type: String }         // e.g., "brain", "heart"
    }],

    // The "Product Details" Table (e.g., Paper Quality, Binding)
    specs: [{
      label: { type: String }, // e.g., "Paper Quality"
      value: { type: String }, // e.g., "100 GSM"
      icon: { type: String }   // e.g., "layer-group"
    }],

    // Manual Testimonials (Specific to this book)
    testimonials: [{
      name: { type: String },
      role: { type: String }, // e.g., "Mother of Aaradhya (5y)"
      text: { type: String },
      rating: { type: Number, default: 5 }
    }]
  }

}, { timestamps: true });

// --- INDICES (Unchanged) ---
BookSchema.index({ title: "text", authors: "text", tags: "text", suggestions: 1 },
  {
    default_language: "english",
    language_override: "__language_override_disabled"
  }
);
BookSchema.index({ "inventory.sku": 1 });
BookSchema.index({ "inventory.asin": 1 });

export default mongoose.model("Book", BookSchema);