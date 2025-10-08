import Order from '../model/Order.js';
import { createBdForOrder, trackBdAwb, findBdOwnerUserId } from './_services/bdOrdershelper.js';
import { trackShipment, schedulePickup, cancelShipment } from './_services/bluedart.js';

export const bdCreateOrders = async (req, res, next) => {
  try {
    const { orderIds = [] } = req.body || {};
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ ok: false, error: 'orderIds required' });
    }

    const ownerId = await findBdOwnerUserId();
    const success = [];
    const failed = [];

    for (const orderId of orderIds) {
      try {
        const result = await createBdForOrder(orderId, ownerId);
        success.push({ orderId, ...result });
      } catch (err) {
        failed.push({ orderId, error: err.message });
      }
    }

    res.json({ ok: true, success, failed });
  } catch (e) { next(e); }
};

export const bdTrackAwb = async (req, res, next) => {
  try {
    const { awb } = req.params;
    const data = await trackBdAwb(awb);
    
    await Order.updateOne(
      { 'shipping.bd.awbNumber': awb },
      { $set: { 'shipping.bd.lastTracking': data, 'shipping.bd.status': data?.status || 'unknown' } }
    );

    res.json({ ok: true, data });
  } catch (e) { next(e); }
};

export const bdSchedulePickup = async (req, res, next) => {
  try {
    const { orderIds = [], pickupDate } = req.body || {};
    const awbs = await Order.find({ _id: { $in: orderIds }, 'shipping.bd.awbNumber': { $exists: true } })
      .distinct('shipping.bd.awbNumber');

    if (!awbs.length) {
      return res.status(400).json({ ok: false, error: 'No AWBs found' });
    }

    const data = await schedulePickup({ awbs, pickupDate });
    
    await Order.updateMany(
      { _id: { $in: orderIds } },
      { $set: { 'shipping.bd.pickupScheduledAt': pickupDate ? new Date(pickupDate) : new Date() } }
    );

    res.json({ ok: true, data });
  } catch (e) { next(e); }
};

export const bdCancelShipment = async (req, res, next) => {
  try {
    const { orderIds = [] } = req.body || {};
    const orders = await Order.find({ _id: { $in: orderIds }, 'shipping.bd.awbNumber': { $exists: true } }).lean();

    const results = [];
    for (const o of orders) {
      try {
        const data = await cancelShipment(o.shipping.bd.awbNumber);
        await Order.updateOne({ _id: o._id }, {
          $set: {
            'shipping.bd.status': 'cancelled',
            'shipping.bd.canceledAt': new Date()
          }
        });
        results.push({ orderId: o._id, ok: true, data });
      } catch (e) {
        results.push({ orderId: o._id, ok: false, error: e.message });
      }
    }

    res.json({ ok: true, results });
  } catch (e) { next(e); }
};
