// backend/routes/bluedartroute.js
import express from 'express';
import {
  createShipment,
  trackShipment,
  getProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  getOrdersForShipment,
  bulkCreateShipments,
  getTransitTime,
  schedulePickup,
  checkServiceability,
  cancelPickup,
  cancelWaybill 
} from '../controller/bluedartcontroller.js';
import { requireAuth } from '../controller/_middleware/auth.js';

const router = express.Router();

// ===== PROFILE MANAGEMENT (Admin Only)
router.get('/profiles', requireAuth(['admin']), getProfiles);
router.post('/profiles', requireAuth(['admin']), createProfile);
router.put('/profiles/:profileId', requireAuth(['admin']), updateProfile);
router.delete('/profiles/:profileId', requireAuth(['admin']), deleteProfile);

// ===== SHIPMENT MANAGEMENT (Admin Only)
router.get('/orders-for-shipment', requireAuth(['admin']), getOrdersForShipment);
router.post('/shipment/create', requireAuth(['admin']), createShipment);
router.post('/shipment/bulk-create', requireAuth(['admin']), bulkCreateShipments);
router.post('/shipment/cancel', requireAuth(['admin']), cancelWaybill);

// ===== TRACKING (Public)
router.get('/shipment/track/:awbNo', trackShipment);

// ===== TRANSIT TIME
router.get('/transit-time', getTransitTime);

// ===== PICKUP MANAGEMENT (Admin Only)
router.post('/pickup/schedule', requireAuth(['admin']), schedulePickup);
router.post('/pickup/cancel', requireAuth(['admin']), cancelPickup);

// ===== LOCATION FINDER (Public - Anyone can check pincode)
router.get('/check-pincode/:pincode', checkServiceability);

export default router;
