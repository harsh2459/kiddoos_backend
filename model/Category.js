import mongoose from "mongoose";

const CategorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true, index: true },
  description: { type: String, default: "" },
  meta: {
    priority: { type: Number, default: 0 }, // for ordering in UI
    visible: { type: Boolean, default: true }
  }
}, { timestamps: true });

export default mongoose.model("Category", CategorySchema);
