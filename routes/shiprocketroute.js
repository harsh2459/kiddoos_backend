// routes/shiprocketroute.js
import { Router } from "express";
import { requireAuth } from "../controller/_middleware/auth.js";
import {
  srServiceability, srCreateOrders, srAssignAwb,
  srSchedulePickup, srGenerateManifest, srGenerateLabel,
  srGenerateInvoice, srTrackAwb, srGetCouriers,
  srBulkServiceability, srCancelShipment, srUpdateWebhook,
  srShipmentDetails
} from "../controller/shiprocketcontroller.js";

const router = Router();
router.use(requireAuth(["admin"]));

router.post("/serviceability", srServiceability);
router.post("/serviceability/bulk", srBulkServiceability);
router.post("/orders/create", srCreateOrders);
router.post("/assign-awb", srAssignAwb);
router.post("/pickup", srSchedulePickup);
router.post("/manifest", srGenerateManifest);
router.post("/label", srGenerateLabel);
router.post("/invoice", srGenerateInvoice);
router.get("/couriers", srGetCouriers);
router.post("/cancel", srCancelShipment);
router.post("/webhook", srUpdateWebhook);
router.get("/shipment/:shipment_id", srShipmentDetails);
router.get("/track/awb/:awb", srTrackAwb);

export default router;