import Book from "../model/Book.js";
import slugify from "slugify";
import { sanitizePathsToRelative } from "../utils/url.js";
import { PUBLIC_BASES } from "../app.js";
import XLSX from "xlsx";
import fs from "fs";
import path from "path";

const toSlug = (s) => slugify(s || "book", { lower: true, strict: true, trim: true });
// Replace the importBooks function in BooksController.js with this COMPLETE VERSION:

export const importBooks = async (req, res) => {
  try {
    const file = req.file;

    console.log("📥 Import request received");
    console.log("📁 File object:", file ? {
      fieldname: file.fieldname,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size
    } : "NO FILE");

    if (!file) {
      console.error("❌ No file in request");
      return res.status(400).json({ ok: false, error: "No file uploaded" });
    }

    console.log("📄 Processing file:", file.originalname);

    // Read Excel/CSV from memory buffer
    const workbook = XLSX.read(file.buffer, { type: "buffer" });
    console.log("📊 Workbook sheets:", workbook.SheetNames);

    // ✅ Find the data sheet - prioritize sheets with "edit" or actual data
    // Exclude example/instruction sheets
    let sheetName = workbook.SheetNames.find(name => {
      const lower = name.toLowerCase();
      // Skip these sheets
      if (lower.includes('example') ||
        lower.includes('instruction') ||
        lower.includes('definition') ||
        lower.includes('dropdown') ||
        lower.includes('validation') ||
        lower.includes('icon') ||
        lower.includes('international') ||
        lower.includes('translation')) {
        return false;
      }
      // Prioritize these
      return lower.includes('edit') ||
        lower.includes('template') ||
        lower.includes('bazaar');
    });

    // If no match, find the sheet with most rows (actual data)
    if (!sheetName) {
      let maxRows = 0;
      for (const name of workbook.SheetNames) {
        const lower = name.toLowerCase();
        // Skip example sheets
        if (lower.includes('example') || lower.includes('instruction')) continue;

        const tempSheet = workbook.Sheets[name];
        const tempData = XLSX.utils.sheet_to_json(tempSheet);
        if (tempData.length > maxRows) {
          maxRows = tempData.length;
          sheetName = name;
        }
      }
    }

    // Fallback to first sheet
    if (!sheetName) {
      sheetName = workbook.SheetNames[0];
    }

    console.log(`📄 Using sheet: "${sheetName}"`);
    const sheet = workbook.Sheets[sheetName];

    // ✅ Parse with header option to handle Bazaar's multi-row headers
    // First, get all data as array of arrays to inspect the structure
    const rawData = XLSX.utils.sheet_to_json(sheet, {
      header: 1, // Get as array of arrays
      defval: "",
      raw: false,
      blankrows: false
    });

    console.log(`📊 Total rows in sheet: ${rawData.length}`);
    console.log("📋 First few rows:", rawData.slice(0, 3));

    // Find the actual header row
    let headerRowIndex = -1;
    let actualHeaders = [];

    for (let i = 0; i < Math.min(10, rawData.length); i++) {
      const row = rawData[i];
      if (!row || row.length === 0) continue;

      const rowStr = row.join('|').toLowerCase();

      // Check if this row contains common header keywords
      const hasHeaders = rowStr.includes('title') ||
        rowStr.includes('price') ||
        rowStr.includes('author') ||
        rowStr.includes('stock') ||
        rowStr.includes('asin');

      if (hasHeaders) {
        headerRowIndex = i;
        actualHeaders = row.map((cell) => {
          const str = String(cell || '').toLowerCase().trim().replace(/\r?\n/g, ' ');
          // Extract the main column name (before any parentheses)
          const mainName = str.split('(')[0].trim();
          return mainName || '';
        });

        console.log(`✅ Found header row at index ${i}`);
        console.log(`📋 Headers:`, actualHeaders);
        break;
      }
    }

    if (headerRowIndex === -1 || actualHeaders.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "Could not identify header row in the Excel file",
        hint: "The file structure might be different than expected"
      });
    }

    // Now parse data starting after the header row
    const data = [];
    for (let i = headerRowIndex + 1; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || row.length === 0) continue;

      const rowData = {};
      for (let j = 0; j < actualHeaders.length && j < row.length; j++) {
        rowData[actualHeaders[j]] = row[j];
      }

      // Skip empty rows (all values are empty)
      if (Object.values(rowData).some(v => v && String(v).trim())) {
        data.push(rowData);
      }
    }

    console.log(`📊 Parsed data length: ${data.length}`);

    if (!data || data.length === 0) {
      return res.status(400).json({ ok: false, error: "File is empty or has no valid data rows" });
    }

    // Show first 2 data rows for debugging
    console.log("📋 Sample data row 1:", data[0]);
    if (data[1]) console.log("📋 Sample data row 2:", data[1]);

    // Auto-detect column names (case-insensitive, flexible matching)
    const getCol = (keywords) => {
      const allKeys = Object.keys(data[0]);
      console.log(`🔍 Looking for column matching: ${keywords.join(", ")}`);

      const key = allKeys.find(k =>
        keywords.some(kw => {
          const colName = String(k).toLowerCase().trim();
          const keyword = String(kw).toLowerCase().trim();
          return colName.includes(keyword) || keyword.includes(colName);
        })
      );

      console.log(`   Found: "${key}" for [${keywords.join(", ")}]`);
      return key;
    };

    // ✅ Updated for your desired format with all fields
    // Title: ASIN Title
    const titleCol = getCol(["asin title", "title", "product-name", "product name", "item-name"]);

    // Author: Look for author/manufacturer (or use Amazon SKU as fallback)
    const authCol = getCol(["author", "authors", "manufacturer", "brand"]);
    const skuCol = getCol(["asin", "amazon sku", "sku", "item-sku", "product-id"]);

    // Format: Usually not in Bazaar, default to paperback
    const formatCol = getCol(["format", "print type", "binding", "type"]);

    // Pages: Not in Bazaar, will default to 0
    const pagesCol = getCol(["pages", "page count", "number of pages"]);

    // Stock: Amazon inventory
    const qtyCol = getCol(["amazon inventory", "inventory", "quantity", "stock", "qty", "available"]);

    // Categories: Not in Bazaar, will use default
    const categoryCol = getCol(["category", "categories", "genre", "subject"]);

    // Tags: Not in Bazaar, will use default
    const tagsCol = getCol(["tags", "keywords"]);

    // Description: ASIN Title or a custom description column
    const descCol = getCol(["description", "details", "about"]);

    // Visibility: Use "Is Bazaar Live?" column (Yes = public, No = draft)
    const visibilityCol = getCol(["is bazaar live", "bazaar live", "live", "status", "visibility"]);

    // MRP: Amazon price
    const mrpCol = getCol(["amazon price", "mrp", "list price", "original price"]);

    // Sale Price: Bazaar price (the main selling price)
    const priceCol = getCol(["bazaar price", "price", "selling price", "sale price"]);

    // Validate we found at least title and price
    if (!titleCol) {
      return res.status(400).json({
        ok: false,
        error: "Could not find title/name column in the file",
        availableColumns: Object.keys(data[0]),
        hint: "Make sure your file has a column with 'title', 'product-name', or 'name'"
      });
    }

    if (!priceCol) {
      return res.status(400).json({
        ok: false,
        error: "Could not find price column in the file",
        availableColumns: Object.keys(data[0]),
        hint: "Make sure your file has a column with 'price', 'mrp', or 'cost'"
      });
    }

    // Process rows
    const books = [];
    const errors = [];
    const skipped = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const rowNum = i + 2; // Excel row number (1-based + 1 for header)

      // Get title
      const title = String(row[titleCol] || "").trim();

      // Skip if no title or if it's a header row repeated
      if (!title || title.toLowerCase() === titleCol?.toLowerCase()) {
        skipped.push(`Row ${rowNum}: Empty or header row`);
        continue;
      }

      // Get authors (from author column or extract from Amazon SKU)
      const authorRaw = authCol ? String(row[authCol] || "").trim() : "";
      const skuRaw = skuCol ? String(row[skuCol] || "").trim() : "";
      let authors = [];

      if (authorRaw) {
        authors = authorRaw.split(/[,;]/).map(a => a.trim()).filter(Boolean);
      } else if (title.includes("Kiddos Intellect")) {
        authors = ["Kiddos Intellect"];
      } else {
        authors = ["Unknown Author"];
      }

      // Get format (default to paperback)
      const format = formatCol ? String(row[formatCol] || "paperback").toLowerCase() : "paperback";
      const validFormats = ["paperback", "hardcover", "ebook"];
      const printType = validFormats.includes(format) ? format : "paperback";

      // Get pages (default to 0)
      const pagesRaw = pagesCol ? String(row[pagesCol] || "0") : "0";
      const pages = parseInt(pagesRaw.replace(/[^0-9]/g, ""), 10) || 0;

      // Get stock (Amazon inventory)
      const stockRaw = String(row[qtyCol] || "0");
      const stockStr = stockRaw.replace(/[^0-9]/g, "");
      const stock = parseInt(stockStr, 10) || 0;

      // Get categories (comma-separated or default)
      const categoriesRaw = categoryCol ? String(row[categoryCol] || "").trim() : "";
      const categories = categoriesRaw
        ? categoriesRaw.split(/[,;]/).map(c => c.trim()).filter(Boolean)
        : ["Books", "Educational"]; // Default categories

      // Get tags (comma-separated)
      const tagsRaw = tagsCol ? String(row[tagsCol] || "").trim() : "";
      const tags = tagsRaw
        ? tagsRaw.split(/[,;]/).map(t => t.trim()).filter(Boolean)
        : ["imported", "bazaar"]; // Default tags

      // Get description (use title if no description column)
      const description = descCol
        ? String(row[descCol] || title).trim()
        : title;

      // Get visibility (Is Bazaar Live? Yes = public, No/empty = draft)
      const visibilityRaw = visibilityCol ? String(row[visibilityCol] || "").toLowerCase() : "";
      const isLive = visibilityRaw === "yes" || visibilityRaw === "y" || visibilityRaw === "true";
      const visibility = (isLive && stock > 0) ? "public" : "draft";

      // Get MRP (Amazon price - the original price)
      const mrpRaw = mrpCol ? String(row[mrpCol] || "0") : "0";
      const mrpStr = mrpRaw.replace(/[^0-9.]/g, "");
      const mrp = parseFloat(mrpStr) || 0;

      // Get Sale Price (Bazaar price - the selling price)
      const priceRaw = String(row[priceCol] || "0");
      const priceStr = priceRaw.replace(/[^0-9.]/g, "");
      const price = parseFloat(priceStr) || 0;

      // Calculate discount percentage
      const discountPct = mrp > 0 && price < mrp
        ? Math.round(((mrp - price) / mrp) * 100)
        : 0;

      console.log(`📝 Row ${rowNum}: "${title}" | Authors: ${authors.join(', ')} | Format: ${printType} | Pages: ${pages} | Stock: ${stock} | MRP: ₹${mrp} | Sale: ₹${price} | Discount: ${discountPct}% | Visibility: ${visibility}`);

      // Validation - only skip if price is invalid
      if (price <= 0) {
        errors.push(`Row ${rowNum}: "${title}" has invalid sale price: ${priceRaw}`);
        continue;
      }

      // Generate unique SKU
      const finalSku = skuRaw || `SKU_${Date.now()}_${i}`;

      books.push({
        title,
        slug: toSlug(title),
        subtitle: "",
        isbn10: "",
        isbn13: "",
        authors: authors,
        language: "English",
        pages: pages,
        edition: "",
        printType: printType,
        mrp: mrp > 0 ? mrp : price, // Use sale price as MRP if MRP is 0
        price: price,
        discountPct: discountPct,
        taxRate: 0,
        currency: "INR",
        inventory: {
          sku: finalSku,
          stock: stock,
          lowStockAlert: 5,
        },
        assets: {
          coverUrl: [],
          samplePdfUrl: "",
        },
        categories: categories,
        tags: tags,
        descriptionHtml: `<p>${description}</p>`,
        visibility: visibility,
      });
    }

    console.log(`📊 Processing summary:
      - Total rows: ${data.length}
      - Valid books: ${books.length}
      - Skipped: ${skipped.length}
      - Errors: ${errors.length}
    `);

    if (books.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "No valid books found in file",
        details: {
          totalRows: data.length,
          skipped: skipped.slice(0, 10),
          errors: errors.slice(0, 10),
          availableColumns: Object.keys(data[0]),
          sampleRow: data[0]
        }
      });
    }

    console.log(`💾 Inserting ${books.length} books into database...`);

    try {
      // Insert with ordered: false to continue on duplicate key errors
      const result = await Book.insertMany(books, { ordered: false });
      const insertedCount = result.length;

      console.log(`✅ Successfully imported ${insertedCount} books`);

      res.status(200).json({
        ok: true,
        count: insertedCount,
        message: `Successfully imported ${insertedCount} out of ${data.length} rows`,
        details: {
          inserted: insertedCount,
          skipped: skipped.length,
          errors: errors.length > 0 ? errors.slice(0, 5) : []
        }
      });

    } catch (insertError) {
      // Handle duplicate key errors
      if (insertError.code === 11000) {
        const insertedCount = insertError.insertedDocs?.length || 0;
        console.log(`⚠️ Partial import: ${insertedCount} books inserted, some duplicates skipped`);

        return res.status(200).json({
          ok: true,
          count: insertedCount,
          message: `Imported ${insertedCount} books (some duplicates were skipped)`,
          details: {
            inserted: insertedCount,
            duplicates: books.length - insertedCount,
            skipped: skipped.length,
            errors: errors.length > 0 ? errors.slice(0, 5) : []
          }
        });
      }
      throw insertError;
    }

  } catch (error) {
    console.error("❌ Import error:", error.message);
    console.error("Stack:", error.stack);

    res.status(500).json({
      ok: false,
      error: error.message || "Failed to import books",
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// Export books to Excel
export const exportBooks = async (req, res) => {
  try {
    const books = await Book.find({});
    console.log(`📤 Exporting ${books.length} books`);

    if (books.length === 0) {
      return res.status(400).json({ ok: false, error: "No books to export" });
    }

    const processedBooks = books.map((book) => ({
      title: book.title,
      authors: Array.isArray(book.authors) ? book.authors.join(", ") : "",
      price: book.price,
      mrp: book.mrp,
      stock: book.inventory?.stock || 0,
      sku: book.inventory?.sku || "",
      categories: Array.isArray(book.categories) ? book.categories.join(", ") : "",
      tags: Array.isArray(book.tags) ? book.tags.join(", ") : "",
      visibility: book.visibility,
    }));

    const ws = XLSX.utils.json_to_sheet(processedBooks);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Books");
    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename=books_export_${Date.now()}.xlsx`);
    res.send(buffer);
  } catch (error) {
    console.error("❌ Export error:", error.message);
    res.status(500).json({ ok: false, error: "Failed to export" });
  }
};

async function uniqueSlugFrom(title) {
  const base = toSlug(title);
  const rx = new RegExp(`^${base}(?:-(\\d+))?$`, "i");
  const rows = await Book.find({ slug: rx }).select("slug -_id").lean();
  if (!rows.length) return base;
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

// In BooksController.js - Replace the listBooks function with this:

export const listBooks = async (req, res, next) => {
  try {
    console.log("📥 Request query params:", req.query);

    const {
      q = "",
      limit = 50,
      page = 1, // ✅ Added pagination
      sort = "new",
      visibility = "all"
    } = req.query;

    const isAdmin = req.user && ["admin", "editor"].includes(req.user.role);

    console.log("👤 User role:", req.user?.role);
    console.log("🔍 Requested visibility:", visibility);
    console.log("👮 Is admin:", isAdmin);
    console.log("📄 Page:", page, "Limit:", limit);

    const where = {};

    // Search filter
    if (q) {
      where.$or = [
        { title: { $regex: q, $options: "i" } },
        { authors: { $regex: q, $options: "i" } },
        { tags: { $regex: q, $options: "i" } },
      ];
    }

    // Visibility filter logic
    if (!isAdmin) {
      where.visibility = "public";
      console.log("🚫 Non-admin: forcing visibility=public");
    } else {
      if (visibility === "public") {
        where.visibility = "public";
        console.log("✅ Admin requesting public books only");
      } else if (visibility === "draft") {
        where.visibility = "draft";
        console.log("✅ Admin requesting draft books only");
      } else {
        console.log("✅ Admin requesting all books (no filter)");
      }
    }

    console.log("🔎 Final MongoDB query:", JSON.stringify(where));

    // ✅ Calculate pagination
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 50;
    const skip = (pageNum - 1) * limitNum;

    // ✅ Get total count (for pagination info)
    const total = await Book.countDocuments(where);

    // ✅ Get paginated results
    const sortBy = sort === "new" ? { createdAt: -1 } : { title: 1 };
    const items = await Book.find(where)
      .sort(sortBy)
      .skip(skip)
      .limit(limitNum);

    console.log(`✅ Found ${items.length} books (page ${pageNum} of ${Math.ceil(total / limitNum)}, total: ${total})`);

    if (items.length > 0) {
      console.log("📚 Sample books visibility:", items.slice(0, 3).map(b => ({
        title: b.title,
        visibility: b.visibility
      })));
    }

    // ✅ Return with pagination metadata
    res.json({
      ok: true,
      items,
      total, // Total number of books matching the query
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum)
    });
  } catch (e) {
    console.error("❌ listBooks error:", e);
    next(e);
  }
};

export const getBook = async (req, res) => {
  const book = await Book.findOne({ slug: req.params.slug, visibility: "public" });
  if (!book) return res.status(404).json({ ok: false, error: "Not found" });
  res.json({ ok: true, book });
};

export const createBook = async (req, res, next) => {
  try {
    const body = sanitizePathsToRelative({ ...(req.body || {}) }, PUBLIC_BASES);

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
      return res
        .status(409)
        .json({ ok: false, error: "A book with this title/slug already exists." });
    }
    return res.status(500).json({ ok: false, error: "Internal error", details: e.message });
  }
};

export const updateBook = async (req, res, next) => {
  try {
    const { id } = req.params;
    const body = sanitizePathsToRelative({ ...(req.body || {}) }, PUBLIC_BASES);

    if (body.assets && Object.prototype.hasOwnProperty.call(body.assets, "coverUrl")) {
      if (typeof body.assets.coverUrl === "string") {
        body.assets.coverUrl = [body.assets.coverUrl];
      } else if (!Array.isArray(body.assets.coverUrl)) {
        body.assets.coverUrl = [];
      }
    } else if (body.assets && Object.keys(body.assets).length === 0) {
      delete body.assets;
    }

    if (typeof body.slug === "string" && body.slug.trim()) {
      const desired = toSlug(body.slug);
      const exists = await Book.findOne({ slug: desired, _id: { $ne: id } }).select("_id");
      if (exists) return res.status(409).json({ ok: false, error: "Slug already taken." });
      body.slug = desired;
    } else {
      delete body.slug;
    }

    const doc = await Book.findByIdAndUpdate(id, body, { new: true, runValidators: true });
    res.json({ ok: true, book: doc });
  } catch (e) {
    if (e?.code === 11000) return res.status(409).json({ ok: false, error: "Slug already taken." });
    next(e);
  }
};

export const getBookById = async (req, res) => {
  try {
    const { idOrSlug } = req.params;

    console.log("🔍 Admin fetching book:", idOrSlug);

    let book = null;

    // Check if it's a valid MongoDB ObjectId (24 hex characters)
    if (idOrSlug.match(/^[0-9a-fA-F]{24}$/)) {
      console.log("📌 Searching by ID:", idOrSlug);
      book = await Book.findById(idOrSlug);
    }

    // If not found by ID, try by slug
    if (!book) {
      console.log("📌 Searching by slug:", idOrSlug);
      book = await Book.findOne({ slug: idOrSlug });
    }

    if (!book) {
      console.log("❌ Book not found:", idOrSlug);
      return res.status(404).json({ ok: false, error: "Book not found" });
    }

    console.log("✅ Book found:", book.title, "| visibility:", book.visibility);
    res.json({ ok: true, book });
  } catch (e) {
    console.error("❌ getBookById error:", e);
    res.status(500).json({ ok: false, error: "Failed to fetch book" });
  }
};

export const deleteBook = async (req, res) => {
  await Book.findByIdAndDelete(req.params.id);
  res.json({ ok: true });
};
