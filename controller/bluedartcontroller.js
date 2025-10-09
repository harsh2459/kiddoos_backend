import Order from '../model/Order.js';
import BlueDartProfile from '../model/BlueDartProfile.js';
import { createBdForOrder, trackBdAwb, findBdOwnerUserId } from './_services/bdOrdershelper.js';
import { 
  trackShipment, schedulePickup, cancelShipment, 
   
} from './_services/bluedart.js';

// Admin: Get orders ready for shipment
export const getOrdersForShipment = async (req, res, next) => {
  try {
    const orders = await Order.find({
      status: 'confirmed',
      'shipping.bd.awbNumber': { $exists: false }
    })
    .populate('customerId', 'name email phone')
    .sort({ createdAt: -1 })
    .lean();

    res.json({ ok: true, orders });
  } catch (e) { next(e); }
};

// Admin: Get all orders with shipment status
export const getAllOrdersWithShipment = async (req, res, next) => {
  try {
    const { status, search } = req.query;
    
    const query = {};
    if (status === 'shipped') query['shipping.bd.awbNumber'] = { $exists: true };
    if (status === 'ready') {
      query.status = 'confirmed';
      query['shipping.bd.awbNumber'] = { $exists: false };
    }
    
    if (search) {
      query.$or = [
        { 'shipping.name': { $regex: search, $options: 'i' } },
        { 'shipping.bd.awbNumber': { $regex: search, $options: 'i' } }
      ];
    }

    const orders = await Order.find(query)
      .populate('customerId', 'name email phone')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ ok: true, orders });
  } catch (e) { next(e); }
};

// Admin: Create shipments
export const bdCreateOrders = async (req, res, next) => {
  try {
    const { orderIds = [], profileId } = req.body || {};
    
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ ok: false, error: 'orderIds required' });
    }

    // Verify orders are confirmed
    const orders = await Order.find({
      _id: { $in: orderIds },
      status: 'confirmed'
    }).lean();

    if (orders.length !== orderIds.length) {
      return res.status(400).json({
        ok: false,
        error: 'Some orders are not confirmed or do not exist'
      });
    }

    // ✅ TRY to find Blue Dart owner, but handle gracefully
    let ownerId;
    try {
      ownerId = await findBdOwnerUserId();
    } catch (e) {
      console.log('⚠️  Blue Dart integration not configured:', e.message);
      return res.status(400).json({ 
        ok: false, 
        error: 'Blue Dart integration not configured. Please set up admin user with Blue Dart integration first.' 
      });
    }

    const success = [];
    const failed = [];

    for (const orderId of orderIds) {
      try {
        const result = await createBdForOrder(orderId, ownerId, profileId);
        success.push({ orderId, ...result });
      } catch (err) {
        failed.push({ orderId, error: err.message });
      }
    }

    res.json({ ok: true, success, failed });
  } catch (e) { 
    next(e); 
  }
};

// Admin: Track AWB
export const bdTrackAwb = async (req, res, next) => {
  try {
    const { awb } = req.params;
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

    res.json({ ok: true, data });
  } catch (e) { next(e); }
};

// Admin: Generate label PDF
export const bdGenerateLabel = async (req, res, next) => {
  try {
    const { awb } = req.params;
    const pdf = await generateLabel(awb);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename=label-${awb}.pdf`);
    res.send(pdf);
  } catch (e) { next(e); }
};

// Admin: Generate invoice PDF
export const bdGenerateInvoice = async (req, res, next) => {
  try {
    const { awb } = req.params;
    const pdf = await generateInvoice(awb);
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename=invoice-${awb}.pdf`);
    res.send(pdf);
  } catch (e) { next(e); }
};

// Admin: Schedule pickup
export const bdSchedulePickup = async (req, res, next) => {
  try {
    const { orderIds = [], pickupDate, pickupAddress } = req.body || {};
    
    const orders = await Order.find({ 
      _id: { $in: orderIds }, 
      'shipping.bd.awbNumber': { $exists: true } 
    }).lean();

    if (!orders.length) {
      return res.status(400).json({ ok: false, error: 'No orders with AWBs found' });
    }

    const awbs = orders.map(o => o.shipping.bd.awbNumber);
    const pickupData = {
      awbs,
      pickupDate: pickupDate || new Date().toISOString().split('T')[0],
      pickupAddress: pickupAddress || process.env.BD_CONSIGNER_ADDRESS
    };

    const data = await schedulePickup(pickupData);
    
    await Order.updateMany(
      { _id: { $in: orderIds } },
      { 
        $set: { 
          'shipping.bd.pickupScheduledAt': new Date(pickupData.pickupDate),
          'shipping.bd.pickupStatus': 'scheduled'
        } 
      }
    );

    res.json({ ok: true, data, scheduledAwbs: awbs });
  } catch (e) { next(e); }
};

// Admin: Cancel shipment
export const bdCancelShipment = async (req, res, next) => {
  try {
    const { orderIds = [] } = req.body || {};
    const orders = await Order.find({ 
      _id: { $in: orderIds }, 
      'shipping.bd.awbNumber': { $exists: true } 
    }).lean();

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
        results.push({ 
          orderId: o._id, 
          awb: o.shipping.bd.awbNumber, 
          ok: true, 
          data 
        });
      } catch (e) {
        results.push({ 
          orderId: o._id, 
          awb: o.shipping.bd?.awbNumber, 
          ok: false, 
          error: e.message 
        });
      }
    }

    res.json({ ok: true, results });
  } catch (e) { next(e); }
};

// Admin: Update shipment weight/dimensions
export const bdUpdateShipmentDetails = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { weight, length, breadth, height } = req.body;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ ok: false, error: 'Order not found' });
    }

    if (order.shipping?.bd?.awbNumber) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Cannot update dimensions after shipment is created' 
      });
    }

    await Order.updateOne({ _id: orderId }, {
      $set: {
        'shipping.weight': weight,
        'shipping.length': length,
        'shipping.breadth': breadth,
        'shipping.height': height
      }
    });

    res.json({ ok: true, message: 'Dimensions updated' });
  } catch (e) { next(e); }
};
