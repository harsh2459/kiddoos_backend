import User from '../../model/User.js';
import Order from '../../model/Order.js';
import { createWaybill, trackShipment } from './bluedart.js';

export async function findBdOwnerUserId() {
  const u = await User.findOne({
    role: 'admin',
    'integrations.bluedart.active': true
  }).select('_id').lean();
  
  if (!u?._id) throw new Error('No admin with active Blue Dart integration');
  return u._id;
}

async function getDefaultDims(order) {
  return {
    weight: Number(order.shipping?.weight ?? process.env.BD_DEF_WEIGHT ?? 0.5),
    length: Number(order.shipping?.length ?? process.env.BD_DEF_LENGTH ?? 20),
    breadth: Number(order.shipping?.breadth ?? process.env.BD_DEF_BREADTH ?? 15),
    height: Number(order.shipping?.height ?? process.env.BD_DEF_HEIGHT ?? 3),
  };
}

// Logger for Blue Dart responses
async function logBD(orderId, type, reqPayload, resPayload, error) {
  await Order.updateOne(
    { _id: orderId },
    {
      $push: {
        'shipping.bd.logs': {
          type,
          at: new Date(),
          request: reqPayload ?? null,
          response: resPayload ?? null,
          error: error ? String(error?.message || error) : null
        }
      }
    }
  );
}

/** Create Blue Dart shipment for order */
export async function createBdForOrder(orderId, ownerUserId) {
  const o = await Order.findById(orderId).lean();
  if (!o) throw new Error('Order not found');
  
  if (o?.shipping?.bd?.awbNumber) {
    return { skipped: true, reason: 'already_created' };
  }

  const ship = o.shipping || {};
  const required = ['address', 'city', 'state', 'pincode', 'phone'];
  const missing = required.filter(k => !String(ship[k] || '').trim());
  
  if (missing.length) {
    throw new Error('Missing shipping fields: ' + missing.join(', '));
  }

  const { weight, length, breadth, height } = await getDefaultDims(o);
  
  const payload = {
    consigner: {
      name: process.env.BD_CONSIGNER_NAME || 'Your Company',
      address: process.env.BD_CONSIGNER_ADDRESS || '',
      city: process.env.BD_CONSIGNER_CITY || '',
      pincode: process.env.BD_CONSIGNER_PINCODE || '',
      phone: process.env.BD_CONSIGNER_PHONE || '',
    },
    consignee: {
      name: ship.name || 'Customer',
      address: ship.address || '',
      city: ship.city || '',
      state: ship.state || '',
      pincode: ship.pincode || '',
      phone: ship.phone || '',
      email: ship.email || '',
    },
    productCode: (o.payment?.status === 'paid') ? 'A' : 'D', // A=Prepaid, D=COD
    pieces: [{
      weight,
      length,
      breadth,
      height,
      declaredValue: o.amount || 0
    }],
    orderNumber: String(o._id),
    invoiceValue: o.amount || 0,
  };

  try {
    const data = await createWaybill(payload);
    const awbNumber = data?.awbNumber || data?.AWBNumber || '';
    
    await Order.updateOne(
      { _id: o._id },
      {
        $set: {
          'shipping.provider': 'bluedart',
          'shipping.bd.awbNumber': awbNumber,
          'shipping.bd.status': 'created',
          'shipping.bd.createdAt': new Date(),
          'shipping.bd.lastCreateResp': data
        }
      }
    );

    await logBD(o._id, 'waybill.create', payload, data, null);
    return { created: true, awbNumber };
    
  } catch (e) {
    await Order.updateOne(
      { _id: o._id },
      { $set: { 'shipping.bd.createStatus': 'failed', 'shipping.bd.createError': e.response?.data || e.message } }
    );
    await logBD(o._id, 'waybill.create', payload, e.response?.data, e);
    throw e;
  }
}

/** Track Blue Dart AWB */
export async function trackBdAwb(awbNumber) {
  return trackShipment(awbNumber);
}
