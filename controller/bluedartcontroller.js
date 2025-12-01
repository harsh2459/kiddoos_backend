// backend/controller/bluedartcontroller.js

import Order from '../model/Order.js';
import BlueDartProfile from '../model/BlueDartProfile.js';
import BlueDartAPI from './_services/bluedart-api.js';
import BlueDartHelpers from './_services/bluedart-helpers.js'; // ✅ IMPORT HELPER

// ✅ 1. CREATE SHIPMENT (Single)
export const createShipment = async (req, res) => {
  try {
    const { orderId, profileId } = req.body;

    if (!orderId) {
      return res.status(400).json({ ok: false, error: 'Order ID required' });
    }

    // Use Helper
    const result = await BlueDartHelpers.createShipmentForOrder(orderId, profileId);

    if (!result.success) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.json({
      ok: true,
      message: 'Shipment created successfully',
      data: result
    });
  } catch (error) {
    console.error('Create shipment error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
};

// ✅ 2. BULK CREATE SHIPMENTS
export const bulkCreateShipments = async (req, res) => {
  try {
    const { orderIds, profileId } = req.body;

    if (!orderIds?.length) {
      return res.status(400).json({ ok: false, error: 'Order IDs required' });
    }

    const results = { success: [], failed: [] };

    // Process strictly sequentially to avoid rate limits
    for (const orderId of orderIds) {
      try {
        // Use Helper for each order
        const result = await BlueDartHelpers.createShipmentForOrder(orderId, profileId);

        if (result.success) {
          results.success.push({
            orderId,
            awbNumber: result.awbNumber,
            codAmount: result.codAmount
          });
        } else {
          results.failed.push({
            orderId,
            error: result.error
          });
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

    const result = await BlueDartAPI.trackShipment(awbNo);
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
      $or: [
        { 'payment.status': 'paid' },
        { 'payment.status': 'partially_paid' }
      ]
    })
      .sort({ createdAt: -1 });

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

export const schedulePickup = async (req, res) => {
  try {
    const { orderIds, pickupDate, pickupTime, profileId } = req.body;

    if (!orderIds?.length || !pickupDate) {
      return res.status(400).json({ ok: false, error: 'Order IDs and pickup date required' });
    }

    // 1. Get Profile (Shipper Details)
    // We reuse the helper to get the profile details
    const profile = await BlueDartHelpers.getProfileOrDefaults(profileId);

    // 2. Prepare Pickup Payload
    // In a real scenario, you might want to sum up the weights of all orders
    const pickupData = {
      customerCode: profile.clientName,
      customerName: profile.consigner.name,
      address1: profile.consigner.address,
      address2: profile.consigner.address2,
      address3: profile.consigner.address3,
      pincode: profile.consigner.pincode,
      phone: profile.consigner.phone,
      mobile: profile.consigner.mobile,
      email: profile.consigner.email,
      pickupDate: pickupDate,
      pickupTime: pickupTime || '1400', // Default 2 PM
      mode: 'SURFACE',
      numberOfPieces: orderIds.length,
      weight: orderIds.length * 0.5 // Estimate 0.5kg per order
    };

    // 3. Call API
    const result = await BlueDartAPI.schedulePickup(pickupData);

    // 4. Update Orders (Optional: Mark them as pickup scheduled)
    await Order.updateMany(
      { _id: { $in: orderIds } },
      { $set: { 'shipping.bd.pickupScheduled': true, 'shipping.bd.pickupDate': pickupDate } }
    );

    res.json({
      ok: true,
      message: 'Pickup Scheduled Successfully',
      data: result
    });

  } catch (error) {
    console.error('Pickup Error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
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
  try {
    const { confirmationNumber } = req.body;
    const result = await BlueDartAPI.cancelPickup(confirmationNumber);
    res.json({ ok: result.success, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

export const cancelWaybill = async (req, res) => {
  try {
    const { awbNumber, orderId } = req.body;
    if (!awbNumber) return res.status(400).json({ ok: false, error: 'AWB Number required' });
    const result = await BlueDartAPI.cancelWaybill(awbNumber);

    if (orderId) {
      await Order.findByIdAndUpdate(orderId, {
        $set: {
          'shipping.bd.status': 'Cancelled',
          'shipping.bd.cancelReason': 'User Request',
          // ✅ CRITICAL: Unset AWB so "Ship" button comes back
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

    res.json({
      ok: true,
      message: 'Shipment cancelled. You can now create a new shipment.'
    });
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