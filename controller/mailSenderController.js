// backend/controllers/mailSenderController.js
import MailSender from "../model/MailSender.js";

export const listSenders = async (_req, res) => {
  const list = await MailSender.find().sort({ updatedAt: -1 });
  res.json({ ok: true, items: list });
};

export const getSender = async (req, res) => {
  const s = await MailSender.findById(req.params.id);
  if (!s) return res.status(404).json({ ok: false, error: "Not found" });
  res.json({ ok: true, sender: s });
};

export const createSender = async (req, res) => {
  try {
    const s = await MailSender.create(req.body);
    res.status(201).json({ ok: true, sender: s });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
};

export const updateSender = async (req, res) => {
  try {
    const s = await MailSender.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!s) return res.status(404).json({ ok: false, error: "Not found" });
    res.json({ ok: true, sender: s });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
};

export const deleteSender = async (req, res) => {
  const s = await MailSender.findByIdAndDelete(req.params.id);
  if (!s) return res.status(404).json({ ok: false, error: "Not found" });
  res.json({ ok: true });
};
