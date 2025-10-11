// backend/controllers/emailTemplateController.js
import EmailTemplate from "../model/EmailTemplate.js";

/* ---- CRUD for Admin ---- */

export const createTemplate = async (req, res) => {
  try {
    const t = await EmailTemplate.create(req.body);
    res.status(201).json(t);
  } catch (err) {
    console.error("createTemplate:", err);
    res.status(400).json({ error: "Failed to create template", details: err.message });
  }
};

export const updateTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const t = await EmailTemplate.findByIdAndUpdate(id, req.body, { new: true });
    if (!t) return res.status(404).json({ error: "Not found" });
    res.json(t);
  } catch (err) {
    console.error("updateTemplate:", err);
    res.status(400).json({ error: "Failed to update template", details: err.message });
  }
};

export const deleteTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const t = await EmailTemplate.findByIdAndDelete(id);
    if (!t) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("deleteTemplate:", err);
    res.status(400).json({ error: "Failed to delete template", details: err.message });
  }
};

export const listTemplates = async (req, res) => {
  try {
    const { category } = req.query;
    const q = {};
    if (category) q.category = category;
    const list = await EmailTemplate.find(q).sort({ updatedAt: -1 }).limit(500);
    res.json(list);
  } catch (err) {
    console.error("listTemplates:", err);
    res.status(500).json({ error: "Failed to list templates" });
  }
};

export const getTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const t = await EmailTemplate.findById(id);
    if (!t) return res.status(404).json({ error: "Not found" });
    res.json(t);
  } catch (err) {
    console.error("getTemplate:", err);
    res.status(500).json({ error: "Failed to get template" });
  }
};

/* ---- Lookup helper (used by mailer/sweep) ---- */
export async function pickAbandonedTemplate(day) {
  // Prefer a day-specific active template; fallback to a generic abandoned template
  let t = await EmailTemplate.findOne({
    category: "abandoned_cart",
    abandonedDay: day,
    isActive: true,
  }).sort({ updatedAt: -1 });

  if (!t) {
    t = await EmailTemplate.findOne({
      category: "abandoned_cart",
      abandonedDay: null,
      isActive: true,
    }).sort({ updatedAt: -1 });
  }
  return t; // may be null
}