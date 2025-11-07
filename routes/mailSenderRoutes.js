// backend/routes/mailSenderRoutes.js
import { Router } from "express";
import {
  listSenders, getSender, createSender, updateSender, deleteSender
} from "../controller/mailSenderController.js";
import { testSendBySender } from "../utils/mailer.js";

const r = Router();

r.get("/", listSenders);
r.get("/:id", getSender);
r.post("/", createSender);
r.patch("/:id", updateSender);
r.delete("/:id", deleteSender);
  
r.post("/:id/test", async (req, res) => {
  try {
    const { id } = req.params;
    const { to, subject, html, text } = req.body;
    await testSendBySender(id, { to, subject, html, text });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

export default r;
