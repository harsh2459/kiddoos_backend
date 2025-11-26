// path: controller/CategoryController.js
import slugify from "slugify";          // <-- add this
import Category from "../model/Category.js";
import Book from "../model/Book.js";

export const listCategories = async (req, res, next) => {
  const cats = await Category.find({ "meta.visible": true }).sort({ "meta.priority": -1, name: 1 }).lean();

  // compute counts with fallback: prefer categoryRefs, fallback to categories string match
  const withCounts = await Promise.all(cats.map(async (c) => {
    let count = 0;
    // try categoryRefs (fast if migration ran)
    if (c._id) {
      count = await Book.countDocuments({ categoryRefs: c._id });
      if (count === 0) {
        // fallback to string matching on book.categories
        count = await Book.countDocuments({ categories: { $in: [c.name, c.slug] } });
      }
    } else {
      count = await Book.countDocuments({ categories: { $in: [c.name, c.slug] } });
    }
    return { ...c, count };
  }));
  res.json({ ok: true, items: withCounts });
};

export const createCategory = async (req, res) => {
  const { name, description, meta } = req.body;
  const slug = slugify(name || "", { lower: true, strict: true, trim: true }); // now works
  const existing = await Category.findOne({ slug });
  if (existing) return res.status(409).json({ ok: false, error: "Category exists" });
  const c = await Category.create({ name, slug, description, meta });
  res.json({ ok: true, category: c });
};
