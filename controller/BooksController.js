import Book from "../model/Book.js";
import slugify from "slugify";
import { sanitizePathsToRelative } from "../utils/url.js";
import { PUBLIC_BASES } from "../app.js";
import XLSX from "xlsx"; // For parsing Excel files
import fs from "fs";
import path from "path";

// Function to generate a unique slug for a book title
const toSlug = (s) => slugify(s || "book", { lower: true, strict: true, trim: true });

// Import books from Excel file
export const importBooks = async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ ok: false, error: "No file uploaded" });
  }
  console.log("importBooks called");

  const file = req.files[0]; // Get the first uploaded file
  const filePath = path.join(__dirname, '..', 'uploads', file.filename); // Save file to server
  console.log("File path: ", filePath);

  try {
    // Read the Excel file
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0]; // Assuming the first sheet is the one we need
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet); // Convert to JSON
    console.log("Excel data: ", data); // Log to verify data

    // Process each row from the Excel sheet
    const books = data.map(item => ({
      title: item.title,
      subtitle: item.subtitle || '',
      isbn10: item.isbn10 || '',
      isbn13: item.isbn13 || '',
      authors: item.authors ? item.authors.split(",") : [],
      language: item.language || 'English',
      pages: item.pages || 0,
      edition: item.edition || '',
      printType: item.printType || 'paperback',
      mrp: item.mrp || 0,
      price: item.price || 0,
      discountPct: item.discountPct || 0,
      taxRate: item.taxRate || 0,
      currency: item.currency || 'INR',
      inventory: {
        sku: item.sku || '',
        stock: item.stock || 0,
        lowStockAlert: item.lowStockAlert || 5
      },
      assets: {
        // Ensure the file is stored as a relative path in the database
        coverUrl: item.coverUrl
          ? item.coverUrl.split(',').map(url => {
            return url.trim().startsWith('/public/uploads/') ? url.trim() : `/public/uploads/${url.trim()}`;
          })
          : [],
        samplePdfUrl: item.samplePdfUrl || ''
      },
      categories: item.categories ? item.categories.split(",") : [],
      tags: item.tags ? item.tags.split(",") : [],
      descriptionHtml: item.descriptionHtml || '',
      visibility: item.visibility || 'public'
    }));

    console.log("Books to be inserted: ", books); // Log to check data before insertion

    // Insert books into the database in bulk
    const insertedBooks = await Book.insertMany(books);

    fs.unlinkSync(filePath); // Clean up the file after processing

    res.status(200).json({ ok: true, insertedBooks });
  } catch (error) {
    fs.unlinkSync(filePath); // Clean up in case of error
    console.error(error);
    res.status(500).json({ ok: false, error: "Failed to import books" });
  }
};

// Export books to Excel
export const exportBooks = async (req, res) => {
  try {
    // Fetch all books from the database
    const books = await Book.find({});

    console.log(`Books fetched: ${books.length}`);

    // If no books are found, send an error
    if (books.length === 0) {
      return res.status(404).json({ ok: false, error: "No books found to export." });
    }

    // Prepare the books data to include absolute image URLs
    const processedBooks = books.map(book => {
      const coverImageUrl = book.assets?.coverUrl?.[0] ? `/public${book.assets.coverUrl[0]}` : null;

      return {
        title: book.title,
        authors: book.authors.join(", "), // Join authors if it's an array
        price: book.price,
        stock: book.inventory?.stock || 0,
        visibility: book.visibility,
        coverImage: coverImageUrl,  // Include the image path/URL here
        categories: book.categories.join(", "), // Join categories if it's an array
        tags: book.tags.join(", "), // Join tags if it's an array
      };
    });

    // Convert the processed books data to a worksheet
    const ws = XLSX.utils.json_to_sheet(processedBooks);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Books");

    // Create a buffer from the workbook
    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    // Set headers for file download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=books_export.xlsx');

    // Send the buffer as a response (Excel file)
    res.send(buffer);
  } catch (error) {
    console.error("Error exporting books:", error);
    res.status(500).json({ ok: false, error: "Failed to export books" });
  }
};
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
  if (!book) return res.status(404).json({ ok: false, error: "Not found" });
  res.json({ ok: true, book });
};

export const createBook = async (req, res, next) => {
  try {
    const body = sanitizePathsToRelative({ ...(req.body || {}) }, PUBLIC_BASES);

    // Normalize coverUrl to array
    if (typeof body.assets?.coverUrl === "string") {
      body.assets.coverUrl = [body.assets.coverUrl];
    } else if (!Array.isArray(body.assets?.coverUrl)) {
      body.assets = { ...(body.assets || {}), coverUrl: [] };
    }

    const slug = await uniqueSlugFrom(body.title || body.slug);
    const doc = await Book.create({ ...body, slug });
    res.json({ ok: true, book: doc });
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(409).json({ ok: false, error: "A book with this title/slug already exists." });
    }
    return res.status(500).json({ ok: false, error: "Internal error", details: e.message });
  }
};

export const updateBook = async (req, res, next) => {
  try {
    const { id } = req.params;

    // sanitize but don't invent fields that weren't sent
    const body = sanitizePathsToRelative({ ...(req.body || {}) }, PUBLIC_BASES);

    // ✅ Only normalize coverUrl IF it was provided in the request body
    if (body.assets && Object.prototype.hasOwnProperty.call(body.assets, "coverUrl")) {
      if (typeof body.assets.coverUrl === "string") {
        body.assets.coverUrl = [body.assets.coverUrl];
      } else if (!Array.isArray(body.assets.coverUrl)) {
        // If the client explicitly sent a non-array (e.g. null), choose your behavior:
        // either clear it…
        body.assets.coverUrl = [];
        // …or: delete body.assets.coverUrl to leave it unchanged
        // delete body.assets.coverUrl;
      }
    } else if (body.assets && Object.keys(body.assets).length === 0) {
      // If client sent an empty assets object, don't overwrite existing doc.assets
      delete body.assets;
    }

    // slug handling (unchanged, just a tiny hardening)
    if (typeof body.slug === "string" && body.slug.trim()) {
      const desired = toSlug(body.slug);
      const exists = await Book.findOne({ slug: desired, _id: { $ne: id } }).select("_id");
      if (exists) return res.status(409).json({ ok: false, error: "Slug already taken." });
      body.slug = desired;
    } else {
      delete body.slug;
    }

    const doc = await Book.findByIdAndUpdate(id, body, {
      new: true,
      runValidators: true, // keep enums etc. safe
    });

    res.json({ ok: true, book: doc });
  } catch (e) {
    if (e?.code === 11000) return res.status(409).json({ ok: false, error: "Slug already taken." });
    next(e);
  }
};

export const deleteBook = async (req, res) => {
  await Book.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
};
