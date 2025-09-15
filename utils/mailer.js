// backend/utils/mailer.js
import nodemailer from "nodemailer";
import MailSender from "../model/MailSender.js";
import EmailTemplate from "../model/EmailTemplate.js";
import { pickAbandonedTemplate } from "../controller/emailTemplateController.js";

function asArray(v) { if (!v) return []; return Array.isArray(v) ? v : [v]; }

function renderString(tpl, ctx = {}) {
  if (!tpl) return "";
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, key) => {
    const val = key.split(".").reduce(
      (acc, k) => (acc != null && acc[k] !== undefined ? acc[k] : undefined),
      ctx
    );
    return (val === undefined || val === null) ? "" : String(val);
  });
}

function renderTemplate({ subject, text, html }, ctx = {}) {
  return { subject: renderString(subject, ctx), text: renderString(text, ctx), html: renderString(html, ctx) };
}

/* ---------- build a transport ---------- */
function buildTransport(sender) {
  if (!sender) throw new Error("No sender provided");
  if (sender.type === "gmail") {
    return nodemailer.createTransport({ service: "gmail", auth: { user: sender.user, pass: sender.pass } });
  }
  return nodemailer.createTransport({
    host: sender.host || "smtp.gmail.com",
    port: sender.port || 587,
    secure: !!sender.secure,
    auth: { user: sender.user, pass: sender.pass },
  });
}

const transportCache = new Map();
function getTransport(sender) {
  const key = String(sender._id);
  if (transportCache.has(key)) return transportCache.get(key);
  const t = buildTransport(sender);
  transportCache.set(key, t);
  return t;
}

export async function sendWithSender(senderId, { to, cc, bcc, subject, html, text, fromEmail, fromName }) {
  const sender = await MailSender.findById(senderId).lean();
  if (!sender || !sender.isActive) throw new Error("Sender not found or inactive");

  const transport = getTransport(sender);
  const from = (fromName || sender.fromName)
    ? `${fromName || sender.fromName} <${fromEmail || sender.fromEmail}>`
    : (fromEmail || sender.fromEmail);

  const mail = {
    from,
    to: asArray(to).join(", "),
    cc: asArray(cc).join(", "),
    bcc: asArray(bcc).join(", "),
    subject, text, html,
  };

  return transport.sendMail(mail);
}

export async function sendBySlug(slug, to, ctx = {}, opts = {}) {
  const tpl = await EmailTemplate.findOne({ slug, isActive: true }).populate("mailSender").lean();
  if (!tpl) throw new Error(`Template not found/inactive: ${slug}`);

  const rendered = renderTemplate({ subject: tpl.subject, text: tpl.text || "", html: tpl.html }, ctx);
  const toAll = [...asArray(tpl.alwaysTo), ...asArray(to)];
  const ccAll = [...asArray(tpl.alwaysCc), ...asArray(opts.cc)];
  const bccAll = [...asArray(tpl.alwaysBcc), ...asArray(opts.bcc)];

  const senderId = tpl.mailSender?._id || opts.senderId;
  if (!senderId) throw new Error("No mail sender linked to template and none provided");

  return sendWithSender(senderId, {
    to: toAll, cc: ccAll, bcc: bccAll,
    subject: rendered.subject, html: rendered.html, text: rendered.text,
    fromEmail: tpl.fromEmail || opts.fromEmail,
    fromName: tpl.fromName || opts.fromName,
  });
}

export async function sendAbandonedCartEmail(customer, day = 1, extra = {}) {
  const t = await pickAbandonedTemplate(day);
  if (!t) { console.warn("No active abandoned-cart template"); return false; }

  const items = (customer.cart?.items || []).map(i => ({
    qty: i.qty, unitPrice: i.unitPriceSnapshot,
    lineTotal: (Number(i.unitPriceSnapshot || 0) * Number(i.qty || 0)),
  }));

  const FRONTEND = process.env.FRONTEND_URL || "https://kidoos-frontend.vercel.app";
  const ctx = {
    day,
    name: customer.name || "there",
    email: customer.email || "",
    phone: customer.phone || "",
    items_count: items.reduce((n, i) => n + Number(i.qty || 0), 0),
    subtotal: customer.cart?.totals?.subTotal ?? 0,
    grand_total: customer.cart?.totals?.grandTotal ?? 0,
    cart_url: `${FRONTEND}/cart`,
    checkout_url: `${FRONTEND}/checkout`,
    ...extra,
  };

  const rendered = renderTemplate({ subject: t.subject, text: t.text || "", html: t.html }, ctx);
  const senderId = (t.mailSender && (t.mailSender._id || t.mailSender)) || null;
  if (!senderId) throw new Error("Abandoned template has no mailSender configured");

  return sendWithSender(senderId, {
    to: customer.email,
    subject: rendered.subject, html: rendered.html, text: rendered.text,
    fromEmail: t.fromEmail, fromName: t.fromName,
  });
}

export async function testSendBySender(senderId, { to, subject, html, text }) {
  if (!to) throw new Error("'to' required");
  if (!subject) subject = "Test Mail";
  if (!html && !text) text = "This is a test.";
  return sendWithSender(senderId, { to, subject, html, text });
}
