import Router from 'express';
import { requireAuth } from '../controller/_middleware/auth.js';
import {
  getOrdersForShipment, getAllOrdersWithShipment, bdCreateOrders, 
  bdTrackAwb, bdGenerateLabel, bdGenerateInvoice,
  bdSchedulePickup, bdCancelShipment, bdUpdateShipmentDetails
} from '../controller/bluedartcontroller.js';

const router = Router();

// All routes require admin access
router.use(requireAuth('admin'));

// Get orders
router.get('/ready', getOrdersForShipment);           // Orders ready for shipment
router.get('/all', getAllOrdersWithShipment);         // All orders with shipment status

// Shipment operations
router.post('/create', bdCreateOrders);               // Create shipments
router.put('/update/:orderId', bdUpdateShipmentDetails); // Update dimensions before shipment

// Tracking & Documents
router.get('/track/:awb', bdTrackAwb);                // Track AWB
router.get('/label/:awb', bdGenerateLabel);           // Download label
router.get('/invoice/:awb', bdGenerateInvoice);       // Download invoice
 
// Pickup & Cancel
router.post('/pickup', bdSchedulePickup);             // Schedule pickup
router.post('/cancel', bdCancelShipment);             // Cancel shipments

export default router;
