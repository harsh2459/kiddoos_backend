// routes/shipmentsroute.js
import Router from 'express';
import { requireAuth } from '../controller/_middleware/auth.js';
import {
  getOrdersForShipment, 
  getAllOrdersWithShipment, 
  bdCreateOrders,
  bdBulkTrack,
  bdTrackAwb, 
  bdGenerateLabel, 
  bdGenerateInvoice,
  bdSchedulePickup,
  bdCancelShipment,
  bdUpdateShipmentDetails,
  bdGetStats
} from '../controller/bluedartcontroller.js';

const router = Router();

// All routes require admin access
router.use(requireAuth('admin'));

// Statistics
router.get('/stats', bdGetStats);

// Get orders
router.get('/ready', getOrdersForShipment);           // Orders ready for shipment
router.get('/all', getAllOrdersWithShipment);         // All orders with shipment status

// Shipment operations
router.post('/create', bdCreateOrders);               // Create shipments (bulk)
router.put('/update/:orderId', bdUpdateShipmentDetails); // Update dimensions before shipment

// Tracking & Documents
router.get('/track/:awb', bdTrackAwb);                // Track single AWB
router.post('/track/bulk', bdBulkTrack);              // Track multiple AWBs
router.get('/label/:awb', bdGenerateLabel);           // Download label
router.get('/invoice/:awb', bdGenerateInvoice);       // Download invoice
 
// Pickup & Cancel
router.post('/pickup', bdSchedulePickup);             // Schedule pickup
router.post('/cancel', bdCancelShipment);             // Cancel shipments

export default router;