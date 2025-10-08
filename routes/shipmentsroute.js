// routes/shipments.route.js
import { Router } from "express";
import { requireAuth } from "../controller/_middleware/auth.js";
import Order from "../model/Order.js";
import {
  bdCreateOrders, bdTrackAwb, bdGenerateLabel,
  bdGenerateInvoice, bdSchedulePickup, bdCancelShipment
} from '../controller/bluedartcontroller.js';
const r = Router();
r.use(requireAuth(["admin"]));


r.post('/create', bdCreateOrders);
r.get('/track/:awb', bdTrackAwb);
r.get('/label/:awb', bdGenerateLabel);
r.get('/invoice/:awb', bdGenerateInvoice);
r.post('/pickup', bdSchedulePickup);
r.post('/cancel', bdCancelShipment);

export default r;
