// backend/controller/bluedartcontroller.js

import Order from '../model/Order.js';
import BlueDartProfile from '../model/BlueDartProfile.js';
import BlueDartAPI from './_services/bluedart-api.js';
import BlueDartHelpers from './_services/bluedart-helpers.js';

// ✅ 1. CREATE SHIPMENT (Single)
export const createShipment = async (req, res) => {
  try {
    const { orderId, profileId } = req.body;
    if (!orderId) return res.status(400).json({ ok: false, error: 'Order ID required' });

    const result = await BlueDartHelpers.createShipmentForOrder(orderId, profileId);

    if (!result.success) return res.status(400).json({ ok: false, error: result.error });

    res.json({ ok: true, message: 'Shipment created successfully', data: result });
  } catch (error) {
    console.error('Create shipment error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
};

// ✅ 2. BULK CREATE SHIPMENTS (Cleaned: No Pickup Params)
export const bulkCreateShipments = async (req, res) => {
  try {
    // ❌ Removed pickupDate, pickupTime from destructuring
    const { orderIds, profileId, length, breadth, height, weight } = req.body;

    if (!orderIds?.length) return res.status(400).json({ ok: false, error: 'Order IDs required' });

    const customOptions = { length, breadth, height, weight };
    const results = { success: [], failed: [] };

    for (const orderId of orderIds) {
      try {
        const result = await BlueDartHelpers.createShipmentForOrder(orderId, profileId, customOptions);
        if (result.success) {
          results.success.push({ orderId, awbNumber: result.awbNumber });
        } else {
          results.failed.push({ orderId, error: result.error });
        }
      } catch (err) {
        results.failed.push({ orderId, error: err.message });
      }
    }

    res.json({
      ok: true,
      message: `Success: ${results.success.length}, Failed: ${results.failed.length}`,
      data: results
    });

  } catch (error) {
    console.error('❌ Bulk create error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
};

// ✅ 3. TRACK SHIPMENT
export const trackShipment = async (req, res) => {
  try {
    const { awbNo } = req.params;
    if (!awbNo) return res.status(400).json({ ok: false, error: 'AWB required' });

    // 1. Get latest status from Blue Dart API
    const result = await BlueDartAPI.trackShipment(awbNo);

    // 2. ✅ SAVE to Database (This was missing)
    if (result.success) {
      await Order.findOneAndUpdate(
        { "shipping.bd.awbNumber": awbNo },
        {
          $set: {
            "shipping.bd.status": result.status, // e.g., "Shipment Delivered"
            "shipping.bd.lastTracking": result,
            "shipping.bd.lastTrackedAt": new Date()
          }
        }
      );
    }

    res.json({ ok: result.success, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// ✅ 4. GET PROFILES
export const getProfiles = async (req, res) => {
  try {
    const profiles = await BlueDartProfile.find({ isActive: true });
    res.json({ ok: true, data: profiles });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

export const createProfile = async (req, res) => {
  try {
    const profile = new BlueDartProfile(req.body);
    await profile.save();
    res.status(201).json({ ok: true, data: profile });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const profile = await BlueDartProfile.findByIdAndUpdate(req.params.profileId, req.body, { new: true });
    if (!profile) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, data: profile });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

export const deleteProfile = async (req, res) => {
  try {
    await BlueDartProfile.findByIdAndDelete(req.params.profileId);
    res.json({ ok: true, message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// ✅ 5. GET ORDERS FOR SHIPMENT
export const getOrdersForShipment = async (req, res) => {
  try {
    const orders = await Order.find({
      status: 'confirmed',
      'shipping.bd.awbNumber': { $exists: false },
      $or: [{ 'payment.status': 'paid' }, { 'payment.status': 'partially_paid' }]
    }).sort({ createdAt: -1 });
    res.json({ ok: true, data: orders });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// ✅ 6. UTILS
export const getTransitTime = async (req, res) => {
  try {
    const result = await BlueDartAPI.getTransitTime(req.query);
    res.json({ ok: result.success, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// ❌ SCHEDULE PICKUP (DISABLED)
// Kept to prevent route crash, but logic is removed.
export const schedulePickup = async (req, res) => {
  return res.json({ ok: false, message: 'Pickup scheduling is disabled.' });
};

export const checkServiceability = async (req, res) => {
  try {
    const result = await BlueDartAPI.checkServiceability(req.params.pincode);
    res.json({ ok: result.success !== false, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

export const cancelPickup = async (req, res) => {
  return res.json({ ok: false, message: 'Pickup cancellation disabled.' });
};

export const cancelWaybill = async (req, res) => {
  try {
    const { awbNumber, orderId } = req.body;
    if (!awbNumber) return res.status(400).json({ ok: false, error: 'AWB Number required' });
    
    await BlueDartAPI.cancelWaybill(awbNumber);

    if (orderId) {
      await Order.findByIdAndUpdate(orderId, {
        $set: {
          'shipping.bd.status': 'Cancelled',
          'shipping.bd.cancelReason': 'User Request',
          'shipping.bd.awbNumber': null,
          'shipping.bd.tokenNumber': null
        },
        $push: {
          'shipping.bd.logs': {
            type: 'CANCEL_WAYBILL',
            request: { awbNumber },
            response: { status: 'Cancelled locally' },
            at: new Date()
          }
        }
      });
    }

    res.json({ ok: true, message: 'Shipment cancelled. You can now create a new shipment.' });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

export default {
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
};