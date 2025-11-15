import Setting from "../model/Setting.js";
import { getBaseFromReq, toAbsolute, sanitizePathsToRelative } from "../utils/url.js";
import { PUBLIC_BASES } from "../app.js";

async function getKey(key, fallback = {}) {
  const doc = await Setting.findOne({ key });
  return doc?.value ?? fallback;
}

// Helper: Check if URL is already absolute (Cloudinary, external, etc.)
function isAbsoluteUrl(url) {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://');
}

// Helper: Convert to absolute only if it's a relative path
function toAbsoluteIfNeeded(url, base) {
  if (!url) return "";
  if (isAbsoluteUrl(url)) return url; // Already absolute, return as-is
  return toAbsolute(url, base); // Convert relative to absolute
}

// PUBLIC
export const getPublicSettings = async (req, res) => {
  const site = await getKey("site", { title: "Catalogue", logoUrl: "", faviconUrl: "" });
  const theme = await getKey("theme", {});
  const homepage = await getKey("homepage", { blocks: [] });
  const payments = await getKey("payments", { providers: [] });
  const visibility = await getKey("visibility", {
    publicNav: ["catalog", "theme", "admin", "cart"],
    pages: { catalog: { public: true }, theme: { public: true }, adminLogin: { public: true } }
  });

  const base = getBaseFromReq(req);
  const siteOut = {
    ...site,
    logoUrl: toAbsoluteIfNeeded(site.logoUrl, base),
    faviconUrl: toAbsoluteIfNeeded(site.faviconUrl, base),
  };

  // FIX: Return enabled status without exposing secrets
  const safePayments = {
    providers: (payments.providers || []).map(p => ({
      id: p.id,
      name: p.name,
      enabled: !!p.enabled
    }))
  };

  res.json({ 
    ok: true, 
    site: siteOut, 
    theme, 
    homepage, 
    payments: safePayments, 
    visibility 
  });
};

export const getAdminSettings = async (req, res) => {
  const site = await getKey("site", {});
  const theme = await getKey("theme", {});
  const homepage = await getKey("homepage", { blocks: [] });
  const payments = await getKey("payments", { providers: [] });
  const visibility = await getKey("visibility", { 
    publicNav: ["catalog", "theme", "admin", "cart"], 
    pages: {} 
  });

  const base = getBaseFromReq(req);
  const siteOut = {
    ...site,
    logoUrl: toAbsoluteIfNeeded(site.logoUrl, base),
    faviconUrl: toAbsoluteIfNeeded(site.faviconUrl, base),
  };

  res.json({ ok: true, site: siteOut, theme, homepage, payments, visibility });
};

// ALWAYS store relative for local paths, but keep absolute URLs as-is
export const updateSiteSettings = async (req, res) => {
  const input = { ...(req.body || {}) };
  
  // Only sanitize to relative if it's NOT an absolute URL
  const sanitized = {
    ...input,
    logoUrl: isAbsoluteUrl(input.logoUrl) 
      ? input.logoUrl 
      : sanitizePathsToRelative({ logoUrl: input.logoUrl }, PUBLIC_BASES).logoUrl,
    faviconUrl: isAbsoluteUrl(input.faviconUrl) 
      ? input.faviconUrl 
      : sanitizePathsToRelative({ faviconUrl: input.faviconUrl }, PUBLIC_BASES).faviconUrl,
  };

  const doc = await Setting.findOneAndUpdate(
    { key: "site" },
    { value: sanitized },
    { upsert: true, new: true }
  );

  const base = getBaseFromReq(req);
  const siteAbs = {
    ...doc.value,
    logoUrl: toAbsoluteIfNeeded(doc.value.logoUrl, base),
    faviconUrl: toAbsoluteIfNeeded(doc.value.faviconUrl, base),
  };

  res.json({ ok: true, site: siteAbs });
};

export const updateThemeSettings = async (req, res) => {
  const doc = await Setting.findOneAndUpdate(
    { key: "theme" }, 
    { value: req.body }, 
    { upsert: true, new: true }
  );
  res.json({ ok: true, theme: doc.value });
};

export const updateHomepage = async (req, res) => {
  const { blocks } = req.body;
  const doc = await Setting.findOneAndUpdate(
    { key: "homepage" }, 
    { value: { blocks } }, 
    { upsert: true, new: true }
  );
  res.json({ ok: true, homepage: doc.value });
};

export const upsertPayments = async (req, res) => {
  const doc = await Setting.findOneAndUpdate(
    { key: "payments" }, 
    { value: req.body }, 
    { upsert: true, new: true }
  );
  res.json({ ok: true, payments: doc.value });
};