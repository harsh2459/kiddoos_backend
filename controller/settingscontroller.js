import Setting from "../model/Setting.js";
import { getBaseFromReq, toAbsolute, sanitizePathsToRelative } from "../utils/url.js";
import { PUBLIC_BASES } from "../app.js"; // or re-derive here if you prefer

async function getKey(key, fallback = {}) {
  const doc = await Setting.findOne({ key });
  return doc?.value ?? fallback;
}

// PUBLIC
export const getPublicSettings = async (req, res) => {
  const site = await getKey("site", { title: "Catalogue", logoUrl: "", faviconUrl: "" });
  const theme = await getKey("theme", {});
  const homepage = await getKey("homepage", { blocks: [] });
  const payments = await getKey("payments", { providers: [] });
  const visibility = await getKey("visibility", {
    publicNav: ["catalog","theme","admin","cart"],
    pages: { catalog:{public:true}, theme:{public:true}, adminLogin:{public:true} }
  });

  const base = getBaseFromReq(req);
  const siteOut = {
    ...site,
    logoUrl: site.logoUrl ? toAbsolute(site.logoUrl, base) : "",
    faviconUrl: site.faviconUrl ? toAbsolute(site.faviconUrl, base) : "",
  };

  const safePayments = {
    providers: (payments.providers || []).map(p => ({ id: p.id, name: p.name, enabled: !!p.enabled }))
  };

  res.json({ ok: true, site: siteOut, theme, homepage, payments: safePayments, visibility });
};

export const getAdminSettings = async (req, res) => {
  const site = await getKey("site", {});
  const theme = await getKey("theme", {});
  const homepage = await getKey("homepage", { blocks: [] });
  const payments = await getKey("payments", { providers: [] });
  const visibility = await getKey("visibility", { publicNav: ["catalog","theme","admin","cart"], pages: {} });

  const base = getBaseFromReq(req);
  const siteOut = {
    ...site,
    logoUrl: site.logoUrl ? toAbsolute(site.logoUrl, base) : "",
    faviconUrl: site.faviconUrl ? toAbsolute(site.faviconUrl, base) : "",
  };

  res.json({ ok: true, site: siteOut, theme, homepage, payments, visibility });
};

// ALWAYS store relative
export const updateSiteSettings = async (req, res) => {
  const input = sanitizePathsToRelative({ ...(req.body || {}) }, PUBLIC_BASES);

  const doc = await Setting.findOneAndUpdate(
    { key: "site" },
    { value: input },
    { upsert: true, new: true }
  );

  const base = getBaseFromReq(req);
  const siteAbs = {
    ...doc.value,
    logoUrl: doc.value.logoUrl ? toAbsolute(doc.value.logoUrl, base) : "",
    faviconUrl: doc.value.faviconUrl ? toAbsolute(doc.value.faviconUrl, base) : "",
  };

  res.json({ ok: true, site: siteAbs });
};

export const updateThemeSettings = async (req, res) => {
  const doc = await Setting.findOneAndUpdate({ key: "theme" }, { value: req.body }, { upsert: true, new: true });
  res.json({ ok: true, theme: doc.value });
};

export const updateHomepage = async (req, res) => {
  const { blocks } = req.body;
  const doc = await Setting.findOneAndUpdate({ key: "homepage" }, { value: { blocks } }, { upsert: true, new: true });
  res.json({ ok: true, homepage: doc.value });
};

export const upsertPayments = async (req, res) => {
  const doc = await Setting.findOneAndUpdate({ key: "payments" }, { value: req.body }, { upsert: true, new: true });
  res.json({ ok: true, payments: doc.value });
};


