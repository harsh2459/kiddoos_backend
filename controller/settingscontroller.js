import Setting from "../model/Setting.js";

// Helper
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

  const safePayments = {
    providers: (payments.providers || []).map(p => ({ id: p.id, name: p.name, enabled: !!p.enabled }))
  };

  res.json({ ok: true, site, theme, homepage, payments: safePayments, visibility });
};

// ADMIN reads everything
export const getAdminSettings = async (req, res) => {
  const site = await getKey("site", {});
  const theme = await getKey("theme", {});
  const homepage = await getKey("homepage", { blocks: [] });
  const payments = await getKey("payments", { providers: [] });
  const visibility = await getKey("visibility", { publicNav: ["catalog","theme","admin","cart"], pages: {} });
  res.json({ ok: true, site, theme, homepage, payments, visibility });
};

export const updateSiteSettings = async (req, res) => {
  const doc = await Setting.findOneAndUpdate({ key: "site" }, { value: req.body }, { upsert: true, new: true });
  res.json({ ok: true, site: doc.value });
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

// NEW: visibility (nav + page gating)
export const updateVisibility = async (req, res) => {
  // { publicNav: ["catalog","theme","admin","cart"], pages: { catalog:{public:true}, settings:{roles:["admin"]}, ... } }
  const value = req.body || {};
  const doc = await Setting.findOneAndUpdate({ key: "visibility" }, { value }, { upsert: true, new: true });
  res.json({ ok: true, visibility: doc.value });
};
