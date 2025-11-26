// scripts/migrateCategories.js
import mongoose from "mongoose";
import Book from "../model/Book.js";
import Category from "../model/Category.js";
import slugify from "slugify";

const toSlug = (s) => slugify(String(s || ""), { lower: true, strict: true, trim: true });

async function run() {
  await mongoose.connect(process.env.MONGO_URI, {});

  try {
    // 1. collect all unique category strings from books
    const books = await Book.find({}, { categories: 1 }).lean();
    const set = new Set();
    for (const b of books) {
      if (Array.isArray(b.categories)) {
        for (const c of b.categories) {
          if (c && String(c).trim()) set.add(String(c).trim());
        }
      }
    }

    console.log("Found categories:", set.size);
    const map = {}; // slug -> category doc _id

    // 2. create Category docs
    for (const name of Array.from(set)) {
      const slug = toSlug(name);
      // find or create
      let cat = await Category.findOne({ slug });
      if (!cat) {
        cat = await Category.create({ name, slug });
        console.log("Created category:", name);
      }
      map[name] = cat._id;
    }

    // 3. update each book with categoryRefs
    let updated = 0;
    for (const b of books) {
      const refs = (b.categories || []).map(c => map[c]).filter(Boolean);
      if (refs.length > 0) {
        await Book.updateOne({ _id: b._id }, { $set: { categoryRefs: refs } });
        updated++;
      }
    }

    console.log(`Updated ${updated} books with categoryRefs`);
  } catch (e) {
    console.error(e);
  } finally {
    await mongoose.disconnect();
  }
}

run();
