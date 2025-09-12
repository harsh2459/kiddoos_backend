// backend/routes/emailTemplateRoutes.js
import { Router } from "express";
import {
  createTemplate, updateTemplate, deleteTemplate,
  listTemplates, getTemplate
} from "../controller/emailTemplateController.js";
import { sendBySlug } from "../utils/mailer.js";

const r = Router();

r.get("/", listTemplates);
r.get("/:id", getTemplate);
r.post("/", createTemplate);
r.patch("/:id", updateTemplate);
r.delete("/:id", deleteTemplate);

r.post("/test/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    const { to, cc, bcc, ctx, senderId } = req.body;
    await sendBySlug(slug, to, ctx || {}, { cc, bcc, senderId });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok:false, error: e.message });
  }
});

export default r;
