// backend/utils/scheduler.js
import cron from "node-cron";
import { runAbandonedCartSweep } from "../controller/customerController.js";

export function startAbandonedCron(app) {
  const spec = (process.env.ABANDONED_CRON || "0 10 * * *").trim();

  if (!cron.validate(spec)) {
    console.warn(`[abandoned-cron] Invalid CRON string "${spec}". Falling back to "0 10 * * *" (10:00 AM daily).`);
  }

  cron.schedule(cron.validate(spec) ? spec : "0 10 * * *", async () => {
    try {
      const res = await runAbandonedCartSweep();
      console.log(`[abandoned-cron] sweep done: sent=${res.sent} expired=${res.expired}`);
    } catch (e) {
      console.error("[abandoned-cron] sweep failed:", e?.message || e);
    }
  }, { scheduled: true, timezone: process.env.TZ || "Asia/Kolkata" });

  // Manual trigger (secure this in prod)
  if (app) {
    app.post("/api/admin/cron/abandoned/run", async (_req, res) => {
      try {
        const out = await runAbandonedCartSweep();
        res.json({ ok: true, ...out });
      } catch (e) {
        res.status(500).json({ ok: false, error: e?.message || "run failed" });
      }
    });
  }

  // Boot sweep once after 10s
  setTimeout(async () => {
    try {
      const out = await runAbandonedCartSweep();
      console.log(`[abandoned-cron] boot sweep: sent=${out.sent} expired=${out.expired}`);
    } catch (e) {
      console.error("[abandoned-cron] boot sweep failed:", e?.message || e);
    }
  }, 10_000);
}
