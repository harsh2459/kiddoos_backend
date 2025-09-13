import Book from "../model/Book.js";
import slugify from "slugify";
import { sanitizePathsToRelative } from "../utils/url.js";
import { PUBLIC_BASES } from "../app.js";

const toSlug = (s) => slugify(s || "book", { lower: true, strict: true, trim: true });

async function uniqueSlugFrom(title) {
  const base = toSlug(title);
  const rx = new RegExp(`^${base}(?:-(\\d+))?$`, "i");
  const rows = await Book.find({ slug: rx }).select("slug -_id").lean();
  if (!rows.length) return base;
  const taken = new Set(rows.map(r => r.slug));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export const listBooks = async (req, res, next) => {
  try {
    const { q = "", limit = 20, sort = "new", visibility = "all" } = req.query;
    const isAdmin = req.user && ["admin", "editor"].includes(req.user.role);

    const where = {};
    if (q) {
      where.$or = [
        { title: { $regex: q, $options: "i" } },
        { authors: { $regex: q, $options: "i" } },
        { tags: { $regex: q, $options: "i" } },
      ];
    }

    if (!isAdmin) {
      // public users can only see public
      where.visibility = "public";
    } else if (visibility !== "all") {
      // admin can filter
      where.visibility = visibility; // 'public' or 'draft'
    }

    const sortBy = sort === "new" ? { createdAt: -1 } : { title: 1 };
    const items = await Book.find(where).sort(sortBy).limit(Number(limit));
    res.json({ ok: true, items });
  } catch (e) { next(e); }
};

export const getBook = async (req, res) => {
  const book = await Book.findOne({ slug: req.params.slug, visibility: "public" });
  if (!book) return res.status(404).json({ ok:false, error:"Not found" });
  res.json({ ok:true, book });
};

export const createBook = async (req, res, next) => {
  try {
    const body = sanitizePathsToRelative({ ...(req.body || {}) }, PUBLIC_BASES);
    const slug = await uniqueSlugFrom(body.title || body.slug);
    const doc = await Book.create({ ...body, slug });
    res.json({ ok: true, book: doc });
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(409).json({ ok: false, error: "A book with this title/slug already exists." });
    }
    next(e);
  }
};

export const updateBook = async (req, res, next) => {
  try {
    const { id } = req.params;
    const body = sanitizePathsToRelative({ ...(req.body || {}) }, PUBLIC_BASES);

    if (typeof body.slug === "string" && body.slug.trim()) {
      const desired = toSlug(body.slug);
      const exists = await Book.findOne({ slug: desired, _id: { $ne: id } }).select("_id");
      if (exists) return res.status(409).json({ ok:false, error:"Slug already taken." });
      body.slug = desired;
    } else {
      delete body.slug;
    }

    const doc = await Book.findByIdAndUpdate(id, body, { new: true });
    res.json({ ok:true, book: doc });
  } catch (e) {
    if (e?.code === 11000) return res.status(409).json({ ok:false, error:"Slug already taken." });
    next(e);
  }
};

export const deleteBook = async (req, res) => {
  await Book.findByIdAndDelete(req.params.id);
  res.json({ ok:true });
};
