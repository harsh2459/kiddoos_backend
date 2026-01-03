import Book from "../model/Book.js";
import slugify from "slugify";
import { sanitizePathsToRelative } from "../utils/url.js";
import { PUBLIC_BASES } from "../app.js";
import XLSX from "xlsx";
import fs from "fs";
import path from "path";
import Category from "../model/Category.js";
const toSlug = (s) => slugify(s || "book", { lower: true, strict: true, trim: true });

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

async function ensureCategoriesExist(categories) {
  if (!Array.isArray(categories) || categories.length === 0) return;

  for (const catName of categories) {
    if (!catName || typeof catName !== 'string') continue;

    const trimmedName = catName.trim();
    const slug = slugify(trimmedName, { lower: true, strict: true, trim: true });

    if (!slug) continue;

    try {
      // Upsert: Try to find by slug, if not found, create it
      // $setOnInsert ensures we don't overwrite existing data like descriptions
      await Category.findOneAndUpdate(
        { slug: slug }, 
        { 
          $setOnInsert: { 
            name: trimmedName, 
            slug: slug, 
            description: "Auto-created via Book Upload",
            meta: { visible: true, priority: 0 }
          }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      // console.log(`✅ Category ensured: ${trimmedName}`);
    } catch (err) {
      console.error(`⚠️ Failed to auto-create category "${trimmedName}":`, err.message);
    }
  }
}

// ✅ 2. REPLACE YOUR EXISTING importBooks FUNCTION WITH THIS:
export const importBooks = async (req, res) => {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({ ok: false, error: "No file uploaded" });
    }

    // Read Excel/CSV from memory buffer
    const workbook = XLSX.read(file.buffer, { type: "buffer" });

    // Find the data sheet - prioritize sheets with specific keywords
    let sheetName = workbook.SheetNames.find(name => {
      const lower = name.toLowerCase();
      // Skip instruction/example sheets
      if (lower.includes('example') || lower.includes('instruction') || 
          lower.includes('definition') || lower.includes('dropdown') ||
          lower.includes('validation')) {
        return false;
      }
      return lower.includes('edit') || lower.includes('template') || lower.includes('bazaar') || lower.includes('data');
    });

    // Fallback: Use the sheet with the most rows
    if (!sheetName) {
      let maxRows = 0;
      for (const name of workbook.SheetNames) {
        const lower = name.toLowerCase();
        if (lower.includes('example') || lower.includes('instruction')) continue;
        const tempSheet = workbook.Sheets[name];
        const range = XLSX.utils.decode_range(tempSheet['!ref'] || "A1");
        const rows = range.e.r;
        if (rows > maxRows) {
          maxRows = rows;
          sheetName = name;
        }
      }
    }

    if (!sheetName) sheetName = workbook.SheetNames[0]; // Final fallback

    const sheet = workbook.Sheets[sheetName];

    // Parse with header option to handle multi-row headers
    const rawData = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: false,
      blankrows: false
    });

    // Find the actual header row
    let headerRowIndex = -1;
    let actualHeaders = [];

    for (let i = 0; i < Math.min(20, rawData.length); i++) {
      const row = rawData[i];
      if (!row || row.length === 0) continue;

      const rowStr = row.join('|').toLowerCase();
      // Look for key columns to identify the header row
      const hasHeaders = rowStr.includes('title') && (rowStr.includes('price') || rowStr.includes('mrp') || rowStr.includes('stock'));

      if (hasHeaders) {
        headerRowIndex = i;
        actualHeaders = row.map((cell) => {
          const str = String(cell || '').toLowerCase().trim().replace(/\r?\n/g, ' ');
          const mainName = str.split('(')[0].trim(); // Remove (Instruction) text
          return mainName || '';
        });
        break;
      }
    }

    if (headerRowIndex === -1 || actualHeaders.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "Could not identify header row. Ensure columns 'Title' and 'Price' exist."
      });
    }

    // Parse data starting after the header row
    const data = [];
    for (let i = headerRowIndex + 1; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || row.length === 0) continue;

      const rowData = {};
      for (let j = 0; j < actualHeaders.length && j < row.length; j++) {
        rowData[actualHeaders[j]] = row[j];
      }

      // Only add row if it has some data
      if (Object.values(rowData).some(v => v && String(v).trim())) {
        data.push(rowData);
      }
    }

    if (data.length === 0) {
      return res.status(400).json({ ok: false, error: "File is empty or has no valid data rows" });
    }

    // Auto-detect column names (case-insensitive, flexible matching)
    const getCol = (keywords) => {
      const allKeys = Object.keys(data[0]);
      const key = allKeys.find(k =>
        keywords.some(kw => {
          const colName = String(k).toLowerCase().trim();
          const keyword = String(kw).toLowerCase().trim();
          return colName === keyword || colName.includes(keyword);
        })
      );
      return key;
    };

    // --- COLUMN MAPPING ---
    const titleCol = getCol(["title", "book name"]);
    const subtitleCol = getCol(["subtitle"]);
    
    const isbn10Col = getCol(["isbn10", "isbn-10", "isbn 10"]);
    const isbn13Col = getCol(["isbn13", "isbn-13", "isbn 13"]);
    const skuCol = getCol(["sku", "identifier"]);
    const asinCol = getCol(["asin"]);
    
    const authCol = getCol(["authors", "author", "writer"]);
    const languageCol = getCol(["language"]);
    
    const formatCol = getCol(["print type", "printtype", "format", "binding"]);
    const pagesCol = getCol(["pages", "no of pages"]);
    const editionCol = getCol(["edition"]);
    
    const weightCol = getCol(["weight"]);
    const lengthCol = getCol(["length"]);
    const widthCol = getCol(["width"]);
    const heightCol = getCol(["height"]);
    
    const qtyCol = getCol(["stock", "quantity", "inventory"]);
    const lowStockCol = getCol(["low stock alert", "low stock", "lowstockalert"]);
    
    const categoryCol = getCol(["categories", "category"]);
    const tagsCol = getCol(["tags", "keywords"]);
    
    const descCol = getCol(["description", "summary"]);
    const whyChooseCol = getCol(["why choose this", "why choose", "highlights"]);
    const suggestionsCol = getCol(["suggestions", "related"]);
    
    const visibilityCol = getCol(["visibility", "status"]);
    
    const mrpCol = getCol(["mrp", "list price"]);
    const priceCol = getCol(["price", "sale price", "selling price"]);
    const taxCol = getCol(["tax rate", "taxrate", "tax", "gst"]);
    const currencyCol = getCol(["currency"]);
    
    const coverUrlCol = getCol(["cover url", "coverurl", "images"]);
    const samplePdfCol = getCol(["sample pdf url", "sample pdf"]);
    
    const templateTypeCol = getCol(["template type", "templatetype", "template"]);

    // Validation
    if (!titleCol) {
      return res.status(400).json({ ok: false, error: "Missing 'Title' column" });
    }
    if (!priceCol && !mrpCol) {
      return res.status(400).json({ ok: false, error: "Missing 'Price' or 'MRP' column" });
    }

    const books = [];
    const skipped = [];
    const errors = [];
    
    // ✅ SET to collect all unique categories from this file
    const allCategoriesSet = new Set();

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const rowNum = i + headerRowIndex + 2; // Actual Excel row number

      // Get Title
      const title = String(row[titleCol] || "").trim();
      if (!title) {
        skipped.push(`Row ${rowNum}: Empty title`);
        continue;
      }

      // Basic fields
      const subtitle = subtitleCol ? String(row[subtitleCol] || "").trim() : "";
      const isbn10 = isbn10Col ? String(row[isbn10Col] || "").trim() : "";
      const isbn13 = isbn13Col ? String(row[isbn13Col] || "").trim() : "";
      const skuRaw = skuCol ? String(row[skuCol] || "").trim() : "";
      const asinRaw = asinCol ? String(row[asinCol] || "").trim() : "";

      // Authors
      const authorRaw = authCol ? String(row[authCol] || "").trim() : "";
      let authors = authorRaw ? authorRaw.split(/[,;]/).map(a => a.trim()).filter(Boolean) : ["Unknown Author"];

      // Language
      const languageRaw = languageCol ? String(row[languageCol] || "English").trim() : "English";
      const language = languageRaw.charAt(0).toUpperCase() + languageRaw.slice(1).toLowerCase();

      // Format
      const format = formatCol ? String(row[formatCol] || "paperback").toLowerCase() : "paperback";
      const printType = ["hardcover", "ebook"].includes(format) ? format : "paperback";

      // Pages & Edition
      const pages = parseInt(String(row[pagesCol] || "0").replace(/[^0-9]/g, ""), 10) || 0;
      const edition = editionCol ? String(row[editionCol] || "").trim() : "";

      // Dimensions
      const weight = parseFloat(String(row[weightCol] || "0").replace(/[^0-9.]/g, "")) || 0;
      const length = parseFloat(String(row[lengthCol] || "0").replace(/[^0-9.]/g, "")) || 0;
      const width = parseFloat(String(row[widthCol] || "0").replace(/[^0-9.]/g, "")) || 0;
      const height = parseFloat(String(row[heightCol] || "0").replace(/[^0-9.]/g, "")) || 0;

      // Stock
      const stock = parseInt(String(row[qtyCol] || "0").replace(/[^0-9]/g, ""), 10) || 0;
      const lowStockAlert = parseInt(String(row[lowStockCol] || "5").replace(/[^0-9]/g, ""), 10) || 5;

      // Pricing
      const mrp = parseFloat(String(row[mrpCol] || "0").replace(/[^0-9.]/g, "")) || 0;
      const priceRaw = parseFloat(String(row[priceCol] || "0").replace(/[^0-9.]/g, "")) || 0;
      const price = priceRaw > 0 ? priceRaw : mrp; // Fallback to MRP if price missing
      
      const taxRate = parseFloat(String(row[taxCol] || "0").replace(/[^0-9.]/g, "")) || 0;
      const currency = currencyCol ? String(row[currencyCol] || "INR").trim() : "INR";

      const discountPct = mrp > 0 && price < mrp ? Math.round(((mrp - price) / mrp) * 100) : 0;

      if (price <= 0 && mrp <= 0) {
        errors.push(`Row ${rowNum}: "${title}" has invalid price`);
        continue;
      }

      // Categories
      const categoriesRaw = categoryCol ? String(row[categoryCol] || "").trim() : "";
      const categories = categoriesRaw
        ? categoriesRaw.split(/[,;]/).map(c => c.trim()).filter(Boolean)
        : ["Books"];
      
      // ✅ Add to Set for auto-creation
      categories.forEach(c => allCategoriesSet.add(c));

      // Tags
      const tagsRaw = tagsCol ? String(row[tagsCol] || "").trim() : "";
      const tags = tagsRaw ? tagsRaw.split(/[,;]/).map(t => t.trim()).filter(Boolean) : [];

      // Description & Content
      const description = descCol ? String(row[descCol] || "").trim() : "";
      const descriptionHtml = description ? `<p>${description.replace(/\n/g, "<br>")}</p>` : "";
      
      const whyChooseRaw = whyChooseCol ? String(row[whyChooseCol] || "").trim() : "";
      const whyChooseThis = whyChooseRaw ? whyChooseRaw.split(/[\n;]/).map(w => w.trim()).filter(Boolean) : [];
      
      const suggestionsRaw = suggestionsCol ? String(row[suggestionsCol] || "").trim() : "";
      const suggestions = suggestionsRaw ? suggestionsRaw.split(/[,;]/).map(s => s.trim()).filter(Boolean) : [];

      // Visibility
      const visibilityRaw = visibilityCol ? String(row[visibilityCol] || "").toLowerCase() : "";
      const visibility = (visibilityRaw === "public" || (stock > 0 && visibilityRaw !== "draft")) ? "public" : "draft";

      // Assets
      const coverUrlRaw = coverUrlCol ? String(row[coverUrlCol] || "").trim() : "";
      const coverUrl = coverUrlRaw ? coverUrlRaw.split(/[,;]/).map(u => u.trim()).filter(Boolean) : [];
      const samplePdfUrl = samplePdfCol ? String(row[samplePdfCol] || "").trim() : "";

      // Template
      const templateTypeRaw = templateTypeCol ? String(row[templateTypeCol] || "standard").toLowerCase() : "standard";
      const templateType = ["spiritual", "activity", "standard"].includes(templateTypeRaw) ? templateTypeRaw : "standard";

      // Generate SKU if missing
      const finalSku = skuRaw || `SKU-${Date.now()}-${i}`;

      books.push({
        title,
        slug: toSlug(title), // Basic slug, will handle uniqueness if needed via error or logic
        subtitle,
        isbn10,
        isbn13,
        authors,
        language,
        pages,
        edition,
        printType,
        mrp: mrp || price,
        price,
        discountPct,
        taxRate,
        currency,
        inventory: {
          sku: finalSku,
          asin: asinRaw,
          stock,
          lowStockAlert,
        },
        dimensions: { weight, length, width, height },
        assets: { coverUrl, samplePdfUrl },
        categories,
        tags,
        descriptionHtml,
        whyChooseThis,
        suggestions,
        visibility,
        templateType,
        layoutConfig: {
          story: {},
          curriculum: [],
          specs: [],
          testimonials: []
        }
      });
    }

    // ============================================================
    // ✅ CRITICAL STEP: Ensure Categories Exist in DB
    // ============================================================
    if (allCategoriesSet.size > 0) {
      console.log(`🔄 Ensuring ${allCategoriesSet.size} categories exist from import...`);
      await ensureCategoriesExist(Array.from(allCategoriesSet));
    }

    // Insert Books (using unordered insert to skip duplicates if any)
    try {
      const result = await Book.insertMany(books, { ordered: false });
      
      res.status(200).json({
        ok: true,
        count: result.length,
        message: `Successfully imported ${result.length} books.`,
        details: {
          inserted: result.length,
          skipped: skipped.length,
          errors: errors.slice(0, 5)
        }
      });

    } catch (insertError) {
      // Handle partial success (some duplicates)
      if (insertError.code === 11000) {
        const insertedCount = insertError.insertedDocs?.length || 0;
        return res.status(200).json({
          ok: true,
          count: insertedCount,
          message: `Imported ${insertedCount} books. Some duplicates were skipped.`,
          details: {
            inserted: insertedCount,
            duplicates: books.length - insertedCount,
            skipped: skipped.length
          }
        });
      }
      throw insertError;
    }

  } catch (error) {
    console.error("❌ Import error:", error);
    res.status(500).json({ 
      ok: false, 
      error: error.message || "Failed to import books",
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined 
    });
  }
};

// Export books to Excel
// Export books to Excel - EXACT match with Book Model
export const exportBooks = async (req, res) => {
  try {
    const books = await Book.find({});
    console.log(`📤 Exporting ${books.length} books`);

    // If no books exist, create a dummy template so the user sees the structure
    const dataToExport = books.length > 0 ? books : [{
      title: "Sample Book (Delete Me)",
      subtitle: "A Guide to Exporting",
      authors: ["Admin User"],
      price: 599,
      mrp: 999,
      inventory: { stock: 100, sku: "SAMPLE-SKU-001" },
      layoutConfig: {
        story: { 
          heading: "Why this book?", 
          text: "Sample story text...", 
          quote: "A great quote" 
        }
      }
    }];

    const processedBooks = dataToExport.map((book) => {
      // Helper to safely get nested values
      const story = book.layoutConfig?.story || {};
      
      return {
        // --- 1. Basic Info ---
        "Title": book.title || "",
        "Subtitle": book.subtitle || "",
        "Authors": Array.isArray(book.authors) ? book.authors.join(", ") : "",
                
        // --- 2. Pricing & Stock ---
        "Price": book.price || 0,
        "MRP": book.mrp || 0,
        "Currency": book.currency || "INR",
        "Stock": book.inventory?.stock || 0,
        "SKU": book.inventory?.sku || "",
        "ASIN": book.inventory?.asin || "",
        "Status": book.visibility || "draft",

        "Pages": book.pages || 0,

        // --- 4. Categories ---
        "Categories": Array.isArray(book.categories) ? book.categories.join(", ") : "",
     
        // --- 5. Content ---
        "Description": (book.descriptionHtml || "").replace(/<[^>]+>/g, ""), // Strip HTML for Excel readability
        "Why Choose": Array.isArray(book.whyChooseThis) ? book.whyChooseThis.join("; ") : "",
        "Suggestions Group": Array.isArray(book.suggestions) ? book.suggestions.join(", ") : "",

      
        // --- 7. PAGE BUILDER (Story Section) ---
        "Story Heading": story.heading || "",
        "Story Text": story.text || "",
        "Story Quote": story.quote || "",

        // --- 8. PAGE BUILDER (Complex JSON Fields) ---
        // We export these as JSON strings so the Import function can read them back
        "Curriculum JSON": book.layoutConfig?.curriculum ? JSON.stringify(book.layoutConfig.curriculum) : "",
        "Specs JSON": book.layoutConfig?.specs ? JSON.stringify(book.layoutConfig.specs) : "",
        "Testimonials JSON": book.layoutConfig?.testimonials ? JSON.stringify(book.layoutConfig.testimonials) : "",
      };
    });

    // Create Sheets
    const wb = XLSX.utils.book_new();

    // Sheet 1: Actual Data
    const wsData = XLSX.utils.json_to_sheet(processedBooks);
    XLSX.utils.book_append_sheet(wb, wsData, "Books Data");

    // Sheet 2: Instructions (Helpful for the admin)
    const instructions = [
      { Field: "Title", Description: "Name of the book (Required)" },
      { Field: "Curriculum JSON", Description: "Paste valid JSON array for curriculum items. Example: [{\"title\":\"Focus\",\"desc\":\"Improves focus\"}]" },
      { Field: "Story Heading", Description: "The main title for the 'Why this book' section" },
      { Field: "Suggestions Group", Description: "Comma separated codes (e.g., 'group_A') to link related books" }
    ];
    const wsInstr = XLSX.utils.json_to_sheet(instructions);
    XLSX.utils.book_append_sheet(wb, wsInstr, "Instructions");

    const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=books_export_${Date.now()}.xlsx`);
    res.send(buffer);

  } catch (error) {
    console.error("❌ Export error:", error);
    res.status(500).json({ ok: false, error: "Failed to export books" });
  }
};


export const listBooks = async (req, res, next) => {
  try {
    // 1. Destructure all possible query parameters
    const {
      q = "",
      limit = 50,
      page = 1,
      sort = "new",
      visibility = "all",
      category,    // Comma-separated slugs: "kids,fiction"
      minPrice,
      maxPrice
    } = req.query;

    const isAdmin = req.user && ["admin", "editor"].includes(req.user.role);
    
    // Start with an empty list of conditions
    // We use $and to ensure ALL conditions (Search + Category + Price) must be met
    const andConditions = [];

    // --- A. SEARCH FILTER ---
    if (q && q.trim()) {
      const regex = new RegExp(q, "i");
      andConditions.push({
        $or: [
          { title: regex },
          { authors: regex },
          { tags: regex },
          { "inventory.sku": regex },
          { "inventory.asin": regex },
        ]
      });
    }

    // --- B. CATEGORY FILTER ---
    if (category) {
      const slugs = category.split(",").map(s => s.trim()).filter(Boolean);
      
      if (slugs.length > 0) {
        // 1. Find the Category Documents to get their IDs and Names
        // We need this because books might be linked by ID (categoryRefs) OR by Name (categories strings)
        let catIds = [];
        let catNames = [];
        
        try {
          const cats = await Category.find({ slug: { $in: slugs } }).select("_id name slug");
          catIds = cats.map(c => c._id);
          catNames = cats.map(c => c.name); // e.g. "Kids"
        } catch (err) {
          console.error("⚠️ Error finding categories in listBooks:", err);
          // Continue even if category lookup fails, falling back to slug matching
        }

        // 2. Build the Category Query
        // Match if: 
        // - Book has the Category ID in `categoryRefs`
        // - OR Book has the Slug in `categories`
        // - OR Book has the Name in `categories` (case-insensitive)
        
        const searchTerms = [...slugs, ...catNames];
        const regexTerms = searchTerms.map(t => new RegExp(`^${t}$`, 'i')); // Exact match, case-insensitive

        andConditions.push({
          $or: [
            { categoryRefs: { $in: catIds } },
            { categories: { $in: regexTerms } } 
          ]
        });
      }
    }

    // --- C. PRICE FILTER ---
    if (minPrice || maxPrice) {
      const priceQuery = {};
      if (minPrice) priceQuery.$gte = Number(minPrice);
      if (maxPrice) priceQuery.$lte = Number(maxPrice);
      
      // Only add if we actually have a number
      if (Object.keys(priceQuery).length > 0) {
        andConditions.push({ price: priceQuery });
      }
    }

    // --- D. VISIBILITY FILTER ---
    if (!isAdmin) {
      // Public users ONLY see public books
      andConditions.push({ visibility: "public" });
    } else {
      // Admins: Check request param
      if (visibility === "public") {
        andConditions.push({ visibility: "public" });
      } else if (visibility === "draft") {
        andConditions.push({ visibility: "draft" });
      }
      // If visibility is 'all', we don't add any visibility constraint
    }

    // --- EXECUTE QUERY ---
    // Combine all conditions into one MongoDB query object
    const finalQuery = andConditions.length > 0 ? { $and: andConditions } : {};

    console.log("🔎 Final listBooks Query:", JSON.stringify(finalQuery, null, 2));

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 50;
    const skip = (pageNum - 1) * limitNum;

    // Sort Logic
    let sortQuery = { createdAt: -1 }; // Default: Newest
    if (sort === "priceAsc") sortQuery = { price: 1 };
    else if (sort === "priceDesc") sortQuery = { price: -1 };
    else if (sort === "a-z") sortQuery = { title: 1 };

    const total = await Book.countDocuments(finalQuery);
    const items = await Book.find(finalQuery)
      .sort(sortQuery)
      .skip(skip)
      .limit(limitNum)
      .lean(); // .lean() makes it faster for read-only

    res.json({
      ok: true,
      items,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum)
    });

  } catch (e) {
    console.error("❌ listBooks error:", e);
    // Don't just next(e), send a clean error so frontend doesn't crash blindly
    res.status(500).json({ ok: false, error: "Failed to load library data." });
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

    // Handle coverUrl array
    if (typeof body.assets?.coverUrl === "string") {
      body.assets.coverUrl = [body.assets.coverUrl];
    } else if (!Array.isArray(body.assets?.coverUrl)) {
      body.assets = { ...(body.assets || {}), coverUrl: [] };
    }

    // Handle whyChooseThis array
    if (body.whyChooseThis) {
      if (typeof body.whyChooseThis === "string") {
        body.whyChooseThis = body.whyChooseThis.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
      } else if (!Array.isArray(body.whyChooseThis)) {
        body.whyChooseThis = [];
      }
    }

    // Handle suggestions array
    if (body.suggestions) {
      if (typeof body.suggestions === "string") {
        body.suggestions = body.suggestions.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
      } else if (!Array.isArray(body.suggestions)) {
        body.suggestions = [];
      }
      body.suggestions = [...new Set(body.suggestions)];
    }

    // Handle Language Capitalization
    if (body.language && typeof body.language === "string") {
      const trimmed = body.language.trim();
      if (trimmed.length > 0) {
        body.language = trimmed[0].toUpperCase() + trimmed.slice(1);
      }
    }

    // Handle Categories Array (ensure it's an array)
    if (body.categories && typeof body.categories === "string") {
        body.categories = body.categories.split(",").map(c => c.trim()).filter(Boolean);
    }

    // ✅ STEP 1: Auto-create any missing categories
    if (body.categories && body.categories.length > 0) {
      await ensureCategoriesExist(body.categories);
    }

    if (body.layoutConfig) {
      if (typeof body.layoutConfig === 'string') {
        try {
          body.layoutConfig = JSON.parse(body.layoutConfig);
        } catch (e) {
          console.error("Error parsing layoutConfig string:", e);
          body.layoutConfig = {};
        }
      }
      ['curriculum', 'specs', 'testimonials', 'trustBadges'].forEach(key => {
        if (body.layoutConfig[key] && !Array.isArray(body.layoutConfig[key])) {
          body.layoutConfig[key] = [];
        }
      });
    }

    // Generate unique slug
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
    const body = sanitizePathsToRelative({ ...(req.body || {}) }, PUBLIC_BASES);

    // 1. Handle Language Capitalization
    if (body.language && typeof body.language === "string") {
      const trimmed = body.language.trim();
      if (trimmed.length > 0) {
        body.language = trimmed[0].toUpperCase() + trimmed.slice(1);
      }
    }

    // 2. Handle coverUrl (Ensure it's always an array)
    if (body.assets && Object.prototype.hasOwnProperty.call(body.assets, "coverUrl")) {
      if (typeof body.assets.coverUrl === "string") {
        body.assets.coverUrl = [body.assets.coverUrl];
      } else if (!Array.isArray(body.assets.coverUrl)) {
        body.assets.coverUrl = [];
      }
    } else if (body.assets && Object.keys(body.assets).length === 0) {
      delete body.assets;
    }

    // 3. Handle whyChooseThis (Convert CSV/lines to Array)
    if (body.whyChooseThis !== undefined) {
      if (typeof body.whyChooseThis === "string") {
        body.whyChooseThis = body.whyChooseThis
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter(Boolean);
      } else if (!Array.isArray(body.whyChooseThis)) {
        body.whyChooseThis = [];
      }
    }

    // 4. Handle suggestions (Convert CSV to Array)
    if (body.suggestions !== undefined) {
      if (typeof body.suggestions === "string") {
        body.suggestions = body.suggestions
          .split(/[,\n]/)
          .map((s) => s.trim())
          .filter(Boolean);
      } else if (!Array.isArray(body.suggestions)) {
        body.suggestions = [];
      }
      body.suggestions = [...new Set(body.suggestions)];
    }

    // 5. ✅ NEW: Handle Layout Config & Template Type (The CMS Logic)
    if (body.layoutConfig) {
      // If data comes from FormData (file upload), it might be a JSON string
      if (typeof body.layoutConfig === 'string') {
        try {
          body.layoutConfig = JSON.parse(body.layoutConfig);
        } catch (e) {
          console.error("Error parsing layoutConfig string:", e);
          // Don't overwrite with empty if parse fails, just ignore
          delete body.layoutConfig; 
        }
      }
      
      // Safety check: Validate nested arrays if they exist
      if (body.layoutConfig) {
        ['curriculum', 'specs', 'testimonials', 'trustBadges'].forEach(key => {
          if (body.layoutConfig[key] && !Array.isArray(body.layoutConfig[key])) {
            body.layoutConfig[key] = [];
          }
        });
      }
    }

    // 6. Handle slug uniqueness
    if (typeof body.slug === "string" && body.slug.trim()) {
      const desired = toSlug(body.slug);
      const exists = await Book.findOne({ slug: desired, _id: { $ne: id } }).select("_id");
      if (exists) return res.status(409).json({ ok: false, error: "Slug already taken." });
      body.slug = desired;
    } else {
      delete body.slug;
    }

    // 7. Perform the Update
    const doc = await Book.findByIdAndUpdate(id, body, { new: true, runValidators: true });
    
    if (!doc) {
      return res.status(404).json({ ok: false, error: "Book not found" });
    }

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

export const getBookWithSuggestions = async (req, res) => {
  try {
    const { slug } = req.params;
    const limit = parseInt(req.query.limit) || 8; // Default to 8 suggestions

    console.log("🔍 Fetching book with suggestions:", slug);

    // Fetch the main book
    const book = await Book.findOne({
      slug,
      visibility: "public"
    }).lean();

    if (!book) {
      console.log("❌ Book not found:", slug);
      return res.status(404).json({
        ok: false,
        error: "Book not found"
      });
    }

    console.log(`✅ Book found: "${book.title}"`);
    console.log(`📋 Book's suggestion groups:`, book.suggestions);

    let relatedBooks = [];

    // If this book has suggestion groups, find all OTHER books in those same groups
    if (book.suggestions && book.suggestions.length > 0) {
      relatedBooks = await Book.find({
        _id: { $ne: book._id }, // Exclude current book
        suggestions: { $in: book.suggestions }, // Has at least one common suggestion group
        visibility: "public"
      })
        .select('title slug authors price mrp discountPct assets.coverUrl categories tags suggestions')
        .limit(limit)
        .sort({ createdAt: -1 }) // Show newest books first
        .lean();

      console.log(`✅ Found ${relatedBooks.length} related books in suggestion groups:`, book.suggestions);
    } else {
      console.log("ℹ️ No suggestion groups defined for this book");
    }

    res.json({
      ok: true,
      book,
      suggestions: relatedBooks,
      suggestionsCount: relatedBooks.length,
      suggestionGroups: book.suggestions || []
    });

  } catch (error) {
    console.error("❌ Error fetching book with suggestions:", error);
    res.status(500).json({
      ok: false,
      error: "Failed to fetch book details",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// ✅ Admin endpoint with suggestions
export const getBookByIdWithSuggestions = async (req, res) => {
  try {
    const { idOrSlug } = req.params;
    console.log("🔍 Admin fetching book with suggestions:", idOrSlug);

    let book = null;

    // Check if it's a valid MongoDB ObjectId
    if (idOrSlug.match(/^[0-9a-fA-F]{24}$/)) {
      book = await Book.findById(idOrSlug).lean();
    }

    // If not found by ID, try by slug
    if (!book) {
      book = await Book.findOne({ slug: idOrSlug }).lean();
    }

    if (!book) {
      return res.status(404).json({ ok: false, error: "Book not found" });
    }

    // Find related books in the same suggestion groups
    let relatedBooks = [];
    if (book.suggestions && book.suggestions.length > 0) {
      relatedBooks = await Book.find({
        _id: { $ne: book._id },
        suggestions: { $in: book.suggestions }
      })
        .select('title slug authors price assets.coverUrl visibility suggestions')
        .lean();
    }

    console.log(`✅ Admin: Book found with ${relatedBooks.length} books in same suggestion groups`);

    res.json({
      ok: true,
      book,
      relatedBooks,
      suggestionsCount: relatedBooks.length
    });

  } catch (error) {
    console.error("❌ Error fetching book:", error);
    res.status(500).json({ ok: false, error: "Failed to fetch book" });
  }
};