// controller/bluedartcontroller.js
import Order from '../model/Order.js';
import BlueDartProfile from '../model/BlueDartProfile.js';
import { createBdForOrder, trackBdAwb, findBdOwnerUserId } from './_services/bdOrdershelper.js';
import { trackShipment, schedulePickup, cancelShipment, generateLabel, generateInvoice } from './_services/bluedart.js'; // ✅ FIXED: Added generateLabel and generateInvoice

// Admin: Get orders ready for shipment
export const getOrdersForShipment = async (req, res, next) => {
  try {
    const orders = await Order.find({
      status: 'confirmed',
      'shipping.bd.awbNumber': { $exists: false }
    })
      .populate('userId', 'name email phone')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ ok: true, orders });
  } catch (e) {
    console.error("getOrdersForShipment error:", e);
    next(e);
  }
};

// Admin: Get all orders with shipment status
export const getAllOrdersWithShipment = async (req, res, next) => {
  try {
    const { status, search } = req.query;
    const query = {};

    if (status === 'shipped') {
      query['shipping.bd.awbNumber'] = { $exists: true };
    } else if (status === 'ready') {
      query.status = 'confirmed';
      query['shipping.bd.awbNumber'] = { $exists: false };
    } else if (status === 'all') {
      // No filter
    } else if (status) {
      query.status = status;
    }

    if (search) {
      query.$or = [
        { 'shipping.name': { $regex: search, $options: 'i' } },
        { 'shipping.phone': { $regex: search, $options: 'i' } },
        { 'shipping.bd.awbNumber': { $regex: search, $options: 'i' } }
      ];
    }

    const orders = await Order.find(query)
      .populate('userId', 'name email phone')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ ok: true, orders, count: orders.length });
  } catch (e) {
    console.error("getAllOrdersWithShipment error:", e);
    next(e);
  }
};

// Admin: Create shipments in bulk
export const bdCreateOrders = async (req, res, next) => {
  try {
    const { orderIds = [], profileId } = req.body || {};

    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ ok: false, error: 'orderIds array required' });
    }

    // Verify orders exist and are in correct status
    const orders = await Order.find({
      _id: { $in: orderIds }
    }).lean();

    if (orders.length !== orderIds.length) {
      return res.status(400).json({
        ok: false,
        error: 'Some order IDs are invalid'
      });
    }

    const readyOrders = await Order.find({
      _id: { $in: orderIds },
      status: 'confirmed',
      paymentStatus: { $in: ['paid', 'pending', 'partially_paid'] }, // ← ADD 'partially_paid'
      'bluedart.awb': { $exists: false }
    });

    // Check if orders are in correct status
    const invalidOrders = orders.filter(o =>
      !['confirmed', 'paid', 'partially_paid'].includes(o.status)
    );

    if (invalidOrders.length > 0) {
      return res.status(400).json({
        ok: false,
        error: `Orders must be confirmed/paid. Invalid orders: ${invalidOrders.map(o => o._id).join(', ')}`
      });
    }

    // Find owner user
    let ownerId;
    try {
      ownerId = await findBdOwnerUserId();
    } catch (e) {
      console.error('⚠️ Blue Dart owner lookup failed:', e.message);
      return res.status(400).json({
        ok: false,
        error: 'Blue Dart integration not configured. Please set up admin user with Blue Dart access.'
      });
    }

    const success = [];
    const failed = [];

    for (const orderId of orderIds) {
      try {
        const result = await createBdForOrder(orderId, ownerId, profileId);
        success.push({ orderId, ...result });

        // Update order status to shipped if shipment created
        if (result.created) {
          await Order.updateOne(
            { _id: orderId },
            { $set: { status: 'shipped' } }
          );
        }
      } catch (err) {
        console.error(`Failed to create shipment for ${orderId}:`, err);
        failed.push({ orderId, error: err.message || String(err) });
      }
    }

    res.json({
      ok: true,
      success,
      failed,
      summary: {
        total: orderIds.length,
        successful: success.length,
        failed: failed.length
      }
    });
  } catch (e) {
    console.error("bdCreateOrders error:", e);
    next(e);
  }
};

// Admin: Track AWB
export const bdTrackAwb = async (req, res, next) => {
  try {
    const { awb } = req.params;

    if (!awb) {
      return res.status(400).json({ ok: false, error: 'AWB number required' });
    }

    const data = await trackBdAwb(awb);

    // Update order with tracking info
    await Order.updateOne(
      { 'shipping.bd.awbNumber': awb },
      {
        $set: {
          'shipping.bd.lastTracking': data,
          'shipping.bd.status': data?.status || data?.shipment_status || 'unknown',
          'shipping.bd.lastTrackedAt': new Date()
        }
      }
    );

    res.json({ ok: true, tracking: data, awb });
  } catch (e) {
    console.error("bdTrackAwb error:", e);
    // Return error details to frontend
    res.status(500).json({
      ok: false,
      error: e.message || 'Tracking failed',
      details: e.response?.data || null
    });
  }
};

// Admin: Bulk track multiple AWBs
export const bdBulkTrack = async (req, res, next) => {
  try {
    const { awbs = [] } = req.body;

    if (!Array.isArray(awbs) || awbs.length === 0) {
      return res.status(400).json({ ok: false, error: 'AWB array required' });
    }

    const results = [];

    for (const awb of awbs) {
      try {
        const data = await trackBdAwb(awb);
        await Order.updateOne(
          { 'shipping.bd.awbNumber': awb },
          {
            $set: {
              'shipping.bd.lastTracking': data,
              'shipping.bd.status': data?.status || 'unknown',
              'shipping.bd.lastTrackedAt': new Date()
            }
          }
        );
        results.push({ awb, ok: true, data });
      } catch (e) {
        results.push({ awb, ok: false, error: e.message });
      }
    }

    res.json({ ok: true, results });
  } catch (e) {
    console.error("bdBulkTrack error:", e);
    next(e);
  }
};

// Admin: Schedule pickup
export const bdSchedulePickup = async (req, res, next) => {
  try {
    const { orderIds = [], pickupDate, pickupAddress } = req.body || {};

    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ ok: false, error: 'orderIds required' });
    }

    const orders = await Order.find({
      _id: { $in: orderIds },
      'shipping.bd.awbNumber': { $exists: true }
    }).lean();

    if (!orders.length) {
      return res.status(400).json({ ok: false, error: 'No orders with AWBs found' });
    }

    const awbs = orders.map(o => o.shipping.bd.awbNumber).filter(Boolean);
    if (awbs.length === 0) {
      return res.status(400).json({ ok: false, error: 'No valid AWB numbers found' });
    }

    // ✅ FIXED: Get profile to pass keys
    const order = orders[0];
    const profileId = order.shipping?.bd?.profileId;
    const profile = profileId
      ? await BlueDartProfile.findById(profileId)
      : await BlueDartProfile.findOne({ isDefault: true });

    const pickupData = {
      awbs,
      pickupDate: pickupDate || new Date().toISOString().split('T')[0],
      pickupAddress: pickupAddress || profile?.consigner?.address || process.env.BD_CONSIGNER_ADDRESS || ''
    };

    // ✅ FIXED: Pass keys to schedulePickup
    const data = await schedulePickup(
      pickupData,
      profile?.shippingKey || process.env.BLUEDART_SHIPPING_KEY,
      profile?.clientName || process.env.BLUEDART_CLIENT_NAME
    );

    // Update orders with pickup info
    await Order.updateMany(
      { _id: { $in: orderIds } },
      {
        $set: {
          'shipping.bd.pickupScheduledAt': new Date(pickupData.pickupDate),
          'shipping.bd.pickupStatus': 'scheduled',
          'shipping.bd.lastPickupResp': data
        }
      }
    );

    res.json({ ok: true, data, scheduledAwbs: awbs, count: awbs.length });
  } catch (e) {
    console.error("bdSchedulePickup error:", e);
    res.status(500).json({
      ok: false,
      error: e.message || 'Pickup scheduling failed',
      details: e.response?.data || null
    });
  }
};

// Admin: Cancel shipments
export const bdCancelShipment = async (req, res, next) => {
  try {
    const { orderIds = [] } = req.body || {};

    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ ok: false, error: 'orderIds required' });
    }

    const orders = await Order.find({
      _id: { $in: orderIds },
      'shipping.bd.awbNumber': { $exists: true }
    }).lean();

    if (!orders.length) {
      return res.status(400).json({ ok: false, error: 'No orders with AWBs found' });
    }

    const results = [];

    for (const o of orders) {
      try {
        // ✅ FIXED: Get profile and pass keys
        const profileId = o.shipping?.bd?.profileId;
        const profile = profileId
          ? await BlueDartProfile.findById(profileId)
          : await BlueDartProfile.findOne({ isDefault: true });

        const data = await cancelShipment(
          o.shipping.bd.awbNumber,
          profile?.shippingKey || process.env.BLUEDART_SHIPPING_KEY,
          profile?.clientName || process.env.BLUEDART_CLIENT_NAME
        );

        await Order.updateOne(
          { _id: o._id },
          {
            $set: {
              'shipping.bd.status': 'cancelled',
              'shipping.bd.canceledAt': new Date(),
              'shipping.bd.cancelResponse': data,
              status: 'cancelled'
            }
          }
        );

        results.push({
          orderId: o._id,
          awb: o.shipping.bd.awbNumber,
          ok: true,
          data
        });
      } catch (e) {
        console.error(`Cancel failed for order ${o._id}:`, e);
        results.push({
          orderId: o._id,
          awb: o.shipping?.bd?.awbNumber,
          ok: false,
          error: e.message || String(e)
        });
      }
    }

    res.json({ ok: true, results });
  } catch (e) {
    console.error("bdCancelShipment error:", e);
    next(e);
  }
};

// Admin: Update shipment weight/dimensions before creating shipment
export const bdUpdateShipmentDetails = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { weight, length, breadth, height } = req.body;

    if (!orderId) {
      return res.status(400).json({ ok: false, error: 'orderId required' });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ ok: false, error: 'Order not found' });
    }

    // Check if shipment already created
    if (order.shipping?.bd?.awbNumber) {
      return res.status(400).json({
        ok: false,
        error: 'Cannot update dimensions after shipment is created',
        awbNumber: order.shipping.bd.awbNumber
      });
    }

    // Validate dimensions
    const updates = {};
    if (weight && weight > 0) updates['shipping.weight'] = Number(weight);
    if (length && length > 0) updates['shipping.length'] = Number(length);
    if (breadth && breadth > 0) updates['shipping.breadth'] = Number(breadth);
    if (height && height > 0) updates['shipping.height'] = Number(height);

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ ok: false, error: 'No valid dimensions provided' });
    }

    await Order.updateOne({ _id: orderId }, { $set: updates });
    const updatedOrder = await Order.findById(orderId);

    res.json({
      ok: true,
      message: 'Dimensions updated successfully',
      order: updatedOrder
    });
  } catch (e) {
    console.error("bdUpdateShipmentDetails error:", e);
    next(e);
  }
};

// Admin: Get shipment statistics
export const bdGetStats = async (req, res, next) => {
  try {
    const stats = await Order.aggregate([
      {
        $facet: {
          readyForShipment: [
            { $match: { status: 'confirmed', 'shipping.bd.awbNumber': { $exists: false } } },
            { $count: 'count' }
          ],
          shipped: [
            { $match: { 'shipping.bd.awbNumber': { $exists: true } } },
            { $count: 'count' }
          ],
          delivered: [
            { $match: { status: 'delivered' } },
            { $count: 'count' }
          ],
          cancelled: [
            { $match: { 'shipping.bd.status': 'cancelled' } },
            { $count: 'count' }
          ],
          pendingPickup: [
            {
              $match: {
                'shipping.bd.awbNumber': { $exists: true },
                'shipping.bd.pickupStatus': { $ne: 'completed' }
              }
            },
            { $count: 'count' }
          ]
        }
      }
    ]);

    const result = {
      readyForShipment: stats[0].readyForShipment[0]?.count || 0,
      shipped: stats[0].shipped[0]?.count || 0,
      delivered: stats[0].delivered[0]?.count || 0,
      cancelled: stats[0].cancelled[0]?.count || 0,
      pendingPickup: stats[0].pendingPickup[0]?.count || 0
    };

    res.json({ ok: true, stats: result });
  } catch (e) {
    console.error("bdGetStats error:", e);
    next(e);
  }
};

// ✅ FIXED: Admin: Download shipping label (now actually works)
export const bdGenerateLabel = async (req, res, next) => {
  try {
    const { awb } = req.params;
    const order = await Order.findOne({ 'shipping.bd.awbNumber': awb });

    if (!order) {
      return res.status(404).json({ ok: false, error: 'Order not found for AWB' });
    }

    // If label URL exists in order, redirect to it
    if (order.shipping.bd.labelUrl) {
      return res.redirect(order.shipping.bd.labelUrl);
    }

    // ✅ FIXED: Get profile and generate label
    const profileId = order.shipping?.bd?.profileId;
    const profile = profileId
      ? await BlueDartProfile.findById(profileId)
      : await BlueDartProfile.findOne({ isDefault: true });

    if (!profile && !process.env.BLUEDART_SHIPPING_KEY) {
      return res.status(400).json({
        ok: false,
        error: 'No BlueDart profile configured'
      });
    }

    const pdf = await generateLabel(
      awb,
      profile?.shippingKey || process.env.BLUEDART_SHIPPING_KEY,
      profile?.clientName || process.env.BLUEDART_CLIENT_NAME
    );

    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename=label-${awb}.pdf`);
    res.send(pdf);
  } catch (e) {
    console.error("bdGenerateLabel error:", e);
    res.status(500).json({
      ok: false,
      error: e.message || 'Label generation failed',
      details: e.response?.data || null
    });
  }
};

// ✅ FIXED: Admin: Download invoice (now actually works)
export const bdGenerateInvoice = async (req, res, next) => {
  try {
    const { awb } = req.params;
    const order = await Order.findOne({ 'shipping.bd.awbNumber': awb });

    if (!order) {
      return res.status(404).json({ ok: false, error: 'Order not found for AWB' });
    }

    // If invoice URL exists, redirect
    if (order.shipping.bd.invoiceUrl) {
      return res.redirect(order.shipping.bd.invoiceUrl);
    }

    // ✅ FIXED: Get profile and generate invoice
    const profileId = order.shipping?.bd?.profileId;
    const profile = profileId
      ? await BlueDartProfile.findById(profileId)
      : await BlueDartProfile.findOne({ isDefault: true });

    if (!profile && !process.env.BLUEDART_SHIPPING_KEY) {
      return res.status(400).json({
        ok: false,
        error: 'No BlueDart profile configured'
      });
    }

    const pdf = await generateInvoice(
      awb,
      profile?.shippingKey || process.env.BLUEDART_SHIPPING_KEY,
      profile?.clientName || process.env.BLUEDART_CLIENT_NAME
    );

    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename=invoice-${awb}.pdf`);
    res.send(pdf);
  } catch (e) {
    console.error("bdGenerateInvoice error:", e);
    res.status(500).json({
      ok: false,
      error: e.message || 'Invoice generation failed',
      details: e.response?.data || null
    });
  }
};