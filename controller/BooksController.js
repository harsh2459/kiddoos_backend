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

export const importBooks = async (req, res) => {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({ ok: false, error: "No file uploaded" });
    }

    // Read Excel/CSV from memory buffer
    const workbook = XLSX.read(file.buffer, { type: "buffer" });

    // ✅ Find the data sheet - prioritize sheets with "edit" or actual data
    let sheetName = workbook.SheetNames.find(name => {
      const lower = name.toLowerCase();
      if (lower.includes('example') || lower.includes('instruction') || 
          lower.includes('definition') || lower.includes('dropdown') ||
          lower.includes('validation') || lower.includes('icon') ||
          lower.includes('international') || lower.includes('translation')) {
        return false;
      }
      return lower.includes('edit') || lower.includes('template') || lower.includes('bazaar');
    });

    if (!sheetName) {
      let maxRows = 0;
      for (const name of workbook.SheetNames) {
        const lower = name.toLowerCase();
        if (lower.includes('example') || lower.includes('instruction')) continue;
        const tempSheet = workbook.Sheets[name];
        const tempData = XLSX.utils.sheet_to_json(tempSheet);
        if (tempData.length > maxRows) {
          maxRows = tempData.length;
          sheetName = name;
        }
      }
    }

    if (!sheetName) {
      sheetName = workbook.SheetNames[0];
    }

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

    for (let i = 0; i < Math.min(10, rawData.length); i++) {
      const row = rawData[i];
      if (!row || row.length === 0) continue;

      const rowStr = row.join('|').toLowerCase();
      const hasHeaders = rowStr.includes('title') || rowStr.includes('price') ||
                        rowStr.includes('author') || rowStr.includes('stock') ||
                        rowStr.includes('asin');

      if (hasHeaders) {
        headerRowIndex = i;
        actualHeaders = row.map((cell) => {
          const str = String(cell || '').toLowerCase().trim().replace(/\r?\n/g, ' ');
          const mainName = str.split('(')[0].trim();
          return mainName || '';
        });
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

    // Parse data starting after the header row
    const data = [];
    for (let i = headerRowIndex + 1; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || row.length === 0) continue;

      const rowData = {};
      for (let j = 0; j < actualHeaders.length && j < row.length; j++) {
        rowData[actualHeaders[j]] = row[j];
      }

      if (Object.values(rowData).some(v => v && String(v).trim())) {
        data.push(rowData);
      }
    }

    console.log(`📊 Parsed data length: ${data.length}`);

    if (!data || data.length === 0) {
      return res.status(400).json({ ok: false, error: "File is empty or has no valid data rows" });
    }

    console.log("📋 Sample data row 1:", data[0]);
    if (data[1]) console.log("📋 Sample data row 2:", data[1]);

    // Auto-detect column names (case-insensitive, flexible matching)
    const getCol = (keywords) => {
      const allKeys = Object.keys(data[0]);
      const key = allKeys.find(k =>
        keywords.some(kw => {
          const colName = String(k).toLowerCase().trim();
          const keyword = String(kw).toLowerCase().trim();
          return colName.includes(keyword) || keyword.includes(colName);
        })
      );
      return key;
    };

    // ✅ COLUMN MAPPING - EXACT MATCH WITH EXPORT TEMPLATE
    
    // Basic Info
    const titleCol = getCol(["title"]);
    const subtitleCol = getCol(["subtitle"]);
    
    // ISBN & Identifiers
    const isbn10Col = getCol(["isbn10", "isbn-10", "isbn 10"]);
    const isbn13Col = getCol(["isbn13", "isbn-13", "isbn 13"]);
    const skuCol = getCol(["sku"]);
    const asinCol = getCol(["asin"]);
    
    // Author & Language
    const authCol = getCol(["authors", "author"]);
    const languageCol = getCol(["language"]);
    
    // Physical Details
    const formatCol = getCol(["print type", "printtype", "format"]);
    const pagesCol = getCol(["pages"]);
    const editionCol = getCol(["edition"]);
    
    // Dimensions
    const weightCol = getCol(["weight"]);
    const lengthCol = getCol(["length"]);
    const widthCol = getCol(["width"]);
    const heightCol = getCol(["height"]);
    
    // Inventory
    const qtyCol = getCol(["stock", "quantity"]);
    const lowStockCol = getCol(["low stock alert", "low stock", "lowstockalert"]);
    
    // Categories & Tags
    const categoryCol = getCol(["categories", "category"]);
    const tagsCol = getCol(["tags"]);
    
    // Content
    const descCol = getCol(["description"]);
    const whyChooseCol = getCol(["why choose this", "why choose"]);
    const suggestionsCol = getCol(["suggestions"]);
    
    // Visibility
    const visibilityCol = getCol(["visibility"]);
    
    // Pricing
    const mrpCol = getCol(["mrp"]);
    const priceCol = getCol(["price"]);
    const discountCol = getCol(["discount %", "discount"]);
    const taxCol = getCol(["tax rate", "taxrate", "tax"]);
    const currencyCol = getCol(["currency"]);
    
    // Assets
    const coverUrlCol = getCol(["cover url", "coverurl", "cover"]);
    const samplePdfCol = getCol(["sample pdf url", "sample pdf", "samplepdfurl"]);
    
    // Template
    const templateTypeCol = getCol(["template type", "templatetype", "template"]);
    
    // Validate required fields
    if (!titleCol) {
      return res.status(400).json({
        ok: false,
        error: "Could not find 'Title' column in the file",
        availableColumns: Object.keys(data[0]),
        hint: "Make sure your file has a column named 'Title'"
      });
    }

    if (!priceCol) {
      return res.status(400).json({
        ok: false,
        error: "Could not find 'Price' column in the file",
        availableColumns: Object.keys(data[0]),
        hint: "Make sure your file has a column named 'Price'"
      });
    }

    // Process rows
    const books = [];
    const errors = [];
    const skipped = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const rowNum = i + 2;

      // Get title
      const title = String(row[titleCol] || "").trim();

      if (!title || title.toLowerCase() === titleCol?.toLowerCase()) {
        skipped.push(`Row ${rowNum}: Empty or header row`);
        continue;
      }

      // Get subtitle
      const subtitle = subtitleCol ? String(row[subtitleCol] || "").trim() : "";
      
      // Get ISBN
      const isbn10 = isbn10Col ? String(row[isbn10Col] || "").trim() : "";
      const isbn13 = isbn13Col ? String(row[isbn13Col] || "").trim() : "";
      
      // Get identifiers
      const skuRaw = skuCol ? String(row[skuCol] || "").trim() : "";
      const asinRaw = asinCol ? String(row[asinCol] || "").trim() : "";

      // Get authors
      const authorRaw = authCol ? String(row[authCol] || "").trim() : "";
      let authors = [];
      if (authorRaw) {
        authors = authorRaw.split(/[,;]/).map(a => a.trim()).filter(Boolean);
      } else if (title.includes("Kiddos Intellect")) {
        authors = ["Kiddos Intellect"];
      } else {
        authors = ["Unknown Author"];
      }

      // Get language
      const languageRaw = languageCol ? String(row[languageCol] || "English").trim() : "English";
      const language = languageRaw.charAt(0).toUpperCase() + languageRaw.slice(1).toLowerCase();

      // Get format
      const format = formatCol ? String(row[formatCol] || "paperback").toLowerCase() : "paperback";
      const validFormats = ["paperback", "hardcover", "ebook"];
      const printType = validFormats.includes(format) ? format : "paperback";

      // Get pages
      const pagesRaw = pagesCol ? String(row[pagesCol] || "0") : "0";
      const pages = parseInt(pagesRaw.replace(/[^0-9]/g, ""), 10) || 0;
      
      // Get edition
      const edition = editionCol ? String(row[editionCol] || "").trim() : "";

      // Get dimensions
      const weightRaw = weightCol ? String(row[weightCol] || "0") : "0";
      const weight = parseFloat(weightRaw.replace(/[^0-9.]/g, "")) || 0;
      
      const lengthRaw = lengthCol ? String(row[lengthCol] || "0") : "0";
      const length = parseFloat(lengthRaw.replace(/[^0-9.]/g, "")) || 0;
      
      const widthRaw = widthCol ? String(row[widthCol] || "0") : "0";
      const width = parseFloat(widthRaw.replace(/[^0-9.]/g, "")) || 0;
      
      const heightRaw = heightCol ? String(row[heightCol] || "0") : "0";
      const height = parseFloat(heightRaw.replace(/[^0-9.]/g, "")) || 0;

      // Get stock
      const stockRaw = String(row[qtyCol] || "0");
      const stockStr = stockRaw.replace(/[^0-9]/g, "");
      const stock = parseInt(stockStr, 10) || 0;
      
      const lowStockRaw = lowStockCol ? String(row[lowStockCol] || "5") : "5";
      const lowStockAlert = parseInt(lowStockRaw.replace(/[^0-9]/g, ""), 10) || 5;

      // Get categories
      const categoriesRaw = categoryCol ? String(row[categoryCol] || "").trim() : "";
      const categories = categoriesRaw
        ? categoriesRaw.split(/[,;]/).map(c => c.trim()).filter(Boolean)
        : ["Books", "Educational"];

      // Get tags
      const tagsRaw = tagsCol ? String(row[tagsCol] || "").trim() : "";
      const tags = tagsRaw
        ? tagsRaw.split(/[,;]/).map(t => t.trim()).filter(Boolean)
        : ["imported", "bazaar"];

      // Get description
      const description = descCol
        ? String(row[descCol] || title).trim()
        : title;
      
      // Get whyChooseThis (bullet points)
      const whyChooseRaw = whyChooseCol ? String(row[whyChooseCol] || "").trim() : "";
      const whyChooseThis = whyChooseRaw
        ? whyChooseRaw.split(/[\n;]/).map(w => w.trim()).filter(Boolean)
        : [];
      
      // Get suggestions
      const suggestionsRaw = suggestionsCol ? String(row[suggestionsCol] || "").trim() : "";
      const suggestions = suggestionsRaw
        ? suggestionsRaw.split(/[,;]/).map(s => s.trim()).filter(Boolean)
        : [];

      // Get visibility
      const visibilityRaw = visibilityCol ? String(row[visibilityCol] || "").toLowerCase() : "";
      const visibility = (visibilityRaw === "public" && stock > 0) ? "public" : "draft";

      // Get pricing
      const mrpRaw = mrpCol ? String(row[mrpCol] || "0") : "0";
      const mrpStr = mrpRaw.replace(/[^0-9.]/g, "");
      const mrp = parseFloat(mrpStr) || 0;

      const priceRaw = String(row[priceCol] || "0");
      const priceStr = priceRaw.replace(/[^0-9.]/g, "");
      const price = parseFloat(priceStr) || 0;
      
      const taxRaw = taxCol ? String(row[taxCol] || "0") : "0";
      const taxRate = parseFloat(taxRaw.replace(/[^0-9.]/g, "")) || 0;
      
      const currencyRaw = currencyCol ? String(row[currencyCol] || "INR").trim() : "INR";
      const currency = currencyRaw || "INR";

      // Calculate discount (ignore if provided in sheet, we calculate it)
      const discountPct = mrp > 0 && price < mrp
        ? Math.round(((mrp - price) / mrp) * 100)
        : 0;

      // Get assets
      const coverUrlRaw = coverUrlCol ? String(row[coverUrlCol] || "").trim() : "";
      const coverUrl = coverUrlRaw 
        ? coverUrlRaw.split(/[,;]/).map(u => u.trim()).filter(Boolean)
        : [];
      
      const samplePdfUrl = samplePdfCol ? String(row[samplePdfCol] || "").trim() : "";

      // Get template type
      const templateTypeRaw = templateTypeCol ? String(row[templateTypeCol] || "standard").toLowerCase() : "standard";
      const validTemplates = ["spiritual", "activity", "standard"];
      const templateType = validTemplates.includes(templateTypeRaw) ? templateTypeRaw : "standard";

      console.log(`🔍 Row ${rowNum}: "${title}" | Authors: ${authors.join(', ')} | ${printType} | ${pages}p | Stock: ${stock} | ₹${price} (${discountPct}% off) | ${visibility}`);

      // Validation
      if (price <= 0) {
        errors.push(`Row ${rowNum}: "${title}" has invalid sale price: ${priceRaw}`);
        continue;
      }

      // Generate unique SKU
      const finalSku = skuRaw || `SKU_${Date.now()}_${i}`;
      const finalAsin = asinRaw || "";

      books.push({
        title,
        slug: toSlug(title),
        subtitle,
        isbn10,
        isbn13,
        authors,
        language,
        pages,
        edition,
        printType,
        mrp: mrp > 0 ? mrp : price,
        price,
        discountPct,
        taxRate,
        currency,
        inventory: {
          sku: finalSku,
          asin: finalAsin,
          stock,
          lowStockAlert,
        },
        dimensions: {
          weight,
          length,
          width,
          height,
        },
        assets: {
          coverUrl,
          samplePdfUrl,
        },
        categories,
        tags,
        descriptionHtml: `<p>${description}</p>`,
        whyChooseThis,
        suggestions,
        visibility,
        templateType,
        // layoutConfig can be added manually later via CMS
        layoutConfig: {
          story: {},
          curriculum: [],
          specs: [],
          testimonials: []
        }
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

    // Handle coverUrl array (Existing Logic)
    if (typeof body.assets?.coverUrl === "string") {
      body.assets.coverUrl = [body.assets.coverUrl];
    } else if (!Array.isArray(body.assets?.coverUrl)) {
      body.assets = { ...(body.assets || {}), coverUrl: [] };
    }

    // Handle whyChooseThis array (Existing Logic)
    if (body.whyChooseThis) {
      if (typeof body.whyChooseThis === "string") {
        body.whyChooseThis = body.whyChooseThis
          .split(/[\n,]/)
          .map(s => s.trim())
          .filter(Boolean);
      } else if (!Array.isArray(body.whyChooseThis)) {
        body.whyChooseThis = [];
      }
    }

    // Handle suggestions array (Existing Logic)
    if (body.suggestions) {
      if (typeof body.suggestions === "string") {
        body.suggestions = body.suggestions
          .split(/[,\n]/)
          .map(s => s.trim())
          .filter(Boolean);
      } else if (!Array.isArray(body.suggestions)) {
        body.suggestions = [];
      }
      body.suggestions = [...new Set(body.suggestions)];
    }

    // Handle Language Capitalization (Existing Logic)
    if (body.language && typeof body.language === "string") {
      const trimmed = body.language.trim();
      if (trimmed.length > 0) {
        body.language = trimmed[0].toUpperCase() + trimmed.slice(1);
      }
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
      // Safety checks for nested arrays
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