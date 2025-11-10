// backend/controller/bluedartController.js

import Order from '../model/Order.js';
import BlueDartProfile from '../model/BlueDartProfile.js';
import BlueDartAPI from './_services/bluedart-api.js';

// ✅ 1. CREATE SHIPMENT (EXISTING)
export const createShipment = async (req, res) => {
  try {
    const { orderId, profileId } = req.body;

    if (!orderId) {
      return res.status(400).json({ ok: false, error: 'Order ID required' });
    }

    const order = await Order.findById(orderId).populate('shippingAddress items.product');

    if (!order) {
      return res.status(404).json({ ok: false, error: 'Order not found' });
    }

    const profile = await BlueDartProfile.findById(profileId || order.blueDartProfile);
    if (!profile) {
      return res.status(404).json({ ok: false, error: 'Blue Dart profile not found' });
    }

    const waybillData = {
      consigner: profile.consigner,
      consignee: {
        name: order.shippingAddress.fullName,
        address: order.shippingAddress.address,
        address2: order.shippingAddress.area || '',
        address3: order.shippingAddress.city || '',
        pincode: order.shippingAddress.pincode,
        phone: order.shippingAddress.phone || '',
        mobile: order.shippingAddress.mobile,
        email: order.shippingAddress.email || ''
      },
      productCode: order.paymentStatus === 'pending' ? 'D' : 'A',
      weight: order.totalWeight || 0.5,
      declaredValue: order.totalAmount,
      codAmount: order.paymentStatus === 'pending' ? order.totalAmount : 0
    };

    const result = await BlueDartAPI.createWaybill(waybillData);

    if (!result.success) {
      return res.status(400).json({ ok: false, error: 'Failed to create waybill' });
    }

    // Update order
    await Order.findByIdAndUpdate(orderId, {
      $set: {
        'shipping.blueDart': {
          awbNumber: result.awbNumber,
          tokenNumber: result.tokenNumber,
          codAmount: result.codAmount,
          productCode: waybillData.productCode,
          status: 'Booked',
          createdAt: new Date()
        }
      }
    });

    res.json({
      ok: true,
      message: 'Shipment created successfully',
      data: {
        awbNumber: result.awbNumber,
        tokenNumber: result.tokenNumber,
        codAmount: result.codAmount
      }
    });
  } catch (error) {
    console.error('Create shipment error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
};

// ✅ 2. TRACK SHIPMENT (EXISTING)
export const trackShipment = async (req, res) => {
  try {
    const { awbNo } = req.params;

    if (!awbNo) {
      return res.status(400).json({ ok: false, error: 'AWB number required' });
    }

    const result = await BlueDartAPI.trackShipment(awbNo);

    res.json({ ok: result.success, data: result });
  } catch (error) {
    console.error('Track error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
};

// ✅ 3. PROFILE MANAGEMENT (EXISTING)
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
    const { label, clientName, shippingKey, trackingKey, consigner, defaults, isDefault } = req.body;

    if (!label || !clientName || !shippingKey) {
      return res.status(400).json({ ok: false, error: 'Required fields missing' });
    }

    const profile = new BlueDartProfile({
      label,
      clientName,
      shippingKey,
      trackingKey: trackingKey || shippingKey,
      consigner,
      defaults,
      isDefault: isDefault || false
    });

    await profile.save();
    res.status(201).json({ ok: true, data: profile });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const { profileId } = req.params;
    const profile = await BlueDartProfile.findByIdAndUpdate(profileId, req.body, { new: true });

    if (!profile) {
      return res.status(404).json({ ok: false, error: 'Profile not found' });
    }

    res.json({ ok: true, data: profile });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

export const deleteProfile = async (req, res) => {
  try {
    const { profileId } = req.params;

    if (!profileId) {
      return res.status(400).json({ ok: false, error: 'Profile ID required' });
    }

    const profile = await BlueDartProfile.findByIdAndDelete(profileId);

    if (!profile) {
      return res.status(404).json({ ok: false, error: 'Profile not found' });
    }

    res.json({ ok: true, message: 'Profile deleted successfully' });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
};

// ✅ 4. GET READY ORDERS (EXISTING)
export const getOrdersForShipment = async (req, res) => {
  try {
    const orders = await Order.find({
      status: 'confirmed',
      'shipping.blueDart.awbNumber': { $exists: false }
    })
      .populate('shippingAddress')
      .sort({ createdAt: -1 });

    res.json({ ok: true, data: orders });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// ✅ 5. BULK CREATE (EXISTING)
export const bulkCreateShipments = async (req, res) => {
  try {
    const { orderIds, profileId } = req.body;

    if (!orderIds?.length) {
      return res.status(400).json({ ok: false, error: 'Order IDs required' });
    }

    const results = { success: [], failed: [] };

    for (const orderId of orderIds) {
      try {
        const order = await Order.findById(orderId).populate('shippingAddress items.product');
        if (!order) {
          results.failed.push({ orderId, error: 'Order not found' });
          continue;
        }
        const profile = await BlueDartProfile.findById(profileId);
        if (!profile) {
          results.failed.push({ orderId, error: 'Profile not found' });
          continue;
        }
        const waybillData = {
          consigner: profile.consigner,
          consignee: {
            name: order.shippingAddress.fullName,
            address: order.shippingAddress.address,
            address2: order.shippingAddress.area || '',
            address3: order.shippingAddress.city || '',
            pincode: order.shippingAddress.pincode,
            phone: order.shippingAddress.phone || '',
            mobile: order.shippingAddress.mobile,
            email: order.shippingAddress.email || ''
          },
          productCode: order.paymentStatus === 'pending' ? 'D' : 'A',
          weight: order.totalWeight || 0.5,
          declaredValue: order.totalAmount,
          codAmount: order.paymentStatus === 'pending' ? order.totalAmount : 0
        };

        const result = await BlueDartAPI.createWaybill(waybillData);

        if (result.success) {
          await Order.findByIdAndUpdate(orderId, {
            $set: {
              'shipping.blueDart': {
                awbNumber: result.awbNumber,
                tokenNumber: result.tokenNumber,
                codAmount: result.codAmount,
                productCode: waybillData.productCode,
                status: 'Booked',
                createdAt: new Date()
              }
            }
          });
          results.success.push({ orderId, awbNumber: result.awbNumber });
        } else {
          results.failed.push({ orderId, error: 'Waybill creation failed' });
        }
      } catch (error) {
        results.failed.push({ orderId, error: error.message });
      }
    }

    res.json({
      ok: true,
      message: `Success: ${results.success.length}, Failed: ${results.failed.length}`,
      data: results
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// 🆕 6. TRANSIT TIME
export const getTransitTime = async (req, res) => {
  try {
    const { fromPincode, toPincode, productCode, pickupDate } = req.query;

    if (!fromPincode || !toPincode) {
      return res.status(400).json({
        ok: false,
        error: 'From and To pincodes required'
      });
    }

    const result = await BlueDartAPI.getTransitTime({
      fromPincode,
      toPincode,
      productCode: productCode || 'A',
      pickupDate: pickupDate || new Date()
    });

    res.json({ ok: result.success, data: result });
  } catch (error) {
    console.error('Transit time error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
};

// 🆕 7. SCHEDULE PICKUP
export const schedulePickup = async (req, res) => {
  try {
    const { orderIds, pickupDate, pickupTime, profileId, mode, numberOfPieces, weight } = req.body;

    if (!orderIds?.length || !pickupDate) {
      return res.status(400).json({
        ok: false,
        error: 'Order IDs and pickup date required'
      });
    }

    const profile = await BlueDartProfile.findById(profileId);
    if (!profile) {
      return res.status(404).json({ ok: false, error: 'Profile not found' });
    }

    const orders = await Order.find({
      _id: { $in: orderIds },
      'shipping.blueDart.awbNumber': { $exists: true }
    });

    if (!orders.length) {
      return res.status(400).json({
        ok: false,
        error: 'No valid shipments found for pickup'
      });
    }

    const pickupData = {
      customerCode: profile.clientName,
      customerName: profile.consigner.name,
      address1: profile.consigner.address,
      address2: profile.consigner.address2 || '',
      address3: profile.consigner.address3 || '',
      pincode: profile.consigner.pincode,
      phone: profile.consigner.phone || '',
      mobile: profile.consigner.mobile,
      email: profile.consigner.email,
      pickupDate,
      pickupTime: pickupTime || '1400',
      mode: mode || 'SURFACE',
      numberOfPieces: numberOfPieces || orders.length,
      weight: weight || orders.length * 0.5,
      requestedBy: req.user?.email || 'admin'
    };

    const result = await BlueDartAPI.schedulePickup(pickupData);

    await Order.updateMany(
      { _id: { $in: orderIds } },
      {
        $set: {
          'shipping.blueDart.pickupConfirmation': result.confirmationNumber,
          'shipping.blueDart.pickupToken': result.tokenNumber,
          'shipping.blueDart.pickupDate': result.pickupDate,
          'shipping.blueDart.pickupScheduled': true,
          'shipping.blueDart.pickupScheduledAt': new Date()
        }
      }
    );

    res.json({
      ok: true,
      message: 'Pickup scheduled successfully',
      data: {
        confirmationNumber: result.confirmationNumber,
        tokenNumber: result.tokenNumber,
        pickupDate: result.pickupDate,
        ordersCount: orders.length
      }
    });
  } catch (error) {
    console.error('Pickup error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
};

// 🆕 8. CHECK SERVICEABILITY
export const checkServiceability = async (req, res) => {
  try {
    const { pincode } = req.params;

    if (!pincode || pincode.length !== 6 || !/^\d{6}$/.test(pincode)) {
      return res.status(400).json({
        ok: false,
        error: 'Valid 6-digit pincode required'
      });
    }

    const result = await BlueDartAPI.checkServiceability(pincode);

    res.json({ ok: result.success !== false, data: result });
  } catch (error) {
    console.error('Serviceability error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
};

// 🆕 9. CANCEL PICKUP
export const cancelPickup = async (req, res) => {
  try {
    const { confirmationNumber, reason, orderIds } = req.body;

    if (!confirmationNumber) {
      return res.status(400).json({
        ok: false,
        error: 'Confirmation number required'
      });
    }

    const result = await BlueDartAPI.cancelPickup(confirmationNumber, reason);

    if (result.success && orderIds?.length) {
      await Order.updateMany(
        { _id: { $in: orderIds } },
        {
          $set: {
            'shipping.blueDart.pickupScheduled': false,
            'shipping.blueDart.pickupCancelled': true,
            'shipping.blueDart.pickupCancelledAt': new Date(),
            'shipping.blueDart.pickupCancelReason': reason || 'User cancelled'
          }
        }
      );
    }

    res.json({ ok: result.success, message: result.message, data: result });
  } catch (error) {
    console.error('Cancel pickup error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
};

// 🆕 10. CANCEL WAYBILL
export const cancelWaybill = async (req, res) => {
  try {
    const { orderId, awbNumber, reason } = req.body;

    if (!awbNumber) {
      return res.status(400).json({
        ok: false,
        error: 'AWB number required'
      });
    }

    const result = await BlueDartAPI.cancelWaybill(awbNumber, reason);

    if (result.success && orderId) {
      await Order.findByIdAndUpdate(orderId, {
        $set: {
          'shipping.blueDart.status': 'Cancelled',
          'shipping.blueDart.cancelledAt': new Date(),
          'shipping.blueDart.cancelReason': reason || 'User cancelled'
        }
      });
    }

    res.json({ ok: result.success, message: result.message, data: result });
  } catch (error) {
    console.error('Cancel waybill error:', error);
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