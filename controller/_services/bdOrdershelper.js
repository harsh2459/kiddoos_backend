import User from '../../model/User.js';
import Order from '../../model/Order.js';
import BlueDartProfile from '../../model/BlueDartProfile.js';
import { createWaybill, trackShipment } from './bluedart.js';

export async function findBdOwnerUserId() {
  // Try to find admin with active Blue Dart integration first
  let u = await User.findOne({
    role: 'admin',
    'integrations.bluedart.active': true
  }).select('_id').lean();
  
  if (u?._id) {
    return u._id;
  }
  
  // ✅ QUIET FALLBACK: Find any admin user (reduced logging)
  u = await User.findOne({ role: 'admin' }).select('_id').lean();
  
  if (u?._id) {
    // ✅ Only log once per server restart
    if (!global.bluedartWarningShown) {
      console.log('⚠️  Blue Dart integration not configured, using fallback admin');
      global.bluedartWarningShown = true;
    }
    return u._id;
  }
  
  u = await User.findOne({}).select('_id').lean();
  
  if (u?._id) {
    if (!global.bluedartWarningShown) {
      console.log('⚠️  No admin found, using first available user');
      global.bluedartWarningShown = true;
    }
    return u._id;
  }
  
  throw new Error('No users found in database');
}

async function getProfileOrDefaults(profileId) {
  if (profileId) {
    const profile = await BlueDartProfile.findById(profileId);
    if (profile) return profile;
  }

  // Get default profile
  const defaultProfile = await BlueDartProfile.findOne({ isDefault: true });
  if (defaultProfile) return defaultProfile;

  // Return env defaults
  return {
    defaults: {
      weight: process.env.BD_DEF_WEIGHT || 0.5,
      length: process.env.BD_DEF_LENGTH || 20,
      breadth: process.env.BD_DEF_BREADTH || 15,
      height: process.env.BD_DEF_HEIGHT || 3
    }
  };
}

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

/** Create Blue Dart shipment for order with COD support */
export async function createBdForOrder(orderId, ownerUserId, profileId = null) {
  const order = await Order.findById(orderId).lean();
  if (!order) throw new Error('Order not found');

  if (order?.shipping?.bd?.awbNumber) {
    return { skipped: true, reason: 'Shipment already created' };
  }

  const profile = await getProfileOrDefaults(profileId);
  const ship = order.shipping || {};

  // Determine product code based on payment type
  let productCode = 'A'; // Prepaid by default
  let codAmount = 0;

  if (order.payment?.paymentType === 'half_online_half_cod') {
    productCode = 'D'; // COD
    codAmount = order.payment?.pendingAmount || Math.floor((order.totals?.grandTotal || order.amount) / 2);
  } else if (order.payment?.paymentType === 'full_cod') {
    productCode = 'D'; // COD
    codAmount = order.totals?.grandTotal || order.amount;
  }

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
    productCode, // A=Prepaid, D=COD
    pieces: [{
      weight: Number(ship.weight || profile.defaults?.weight || 0.5),
      length: Number(ship.length || profile.defaults?.length || 20),
      breadth: Number(ship.breadth || profile.defaults?.breadth || 15),
      height: Number(ship.height || profile.defaults?.height || 3),
      declaredValue: order.totals?.grandTotal || order.amount || 0
    }],
    orderNumber: String(order._id),
    invoiceValue: order.totals?.grandTotal || order.amount || 0,
    codAmount: codAmount, // COD amount if applicable
  };

  try {
    const data = await createWaybill(payload);
    const awbNumber = data?.awbNumber || data?.AWBNumber || '';

    await Order.updateOne(
      { _id: order._id },
      {
        $set: {
          'shipping.provider': 'bluedart',
          'shipping.bd.profileId': profileId,
          'shipping.bd.awbNumber': awbNumber,
          'shipping.bd.status': 'created',
          'shipping.bd.productCode': productCode,
          'shipping.bd.codAmount': codAmount,
          'shipping.bd.createdAt': new Date(),
          'shipping.bd.lastCreateResp': data
        }
      }
    );

    await logBD(order._id, 'waybill.create', payload, data, null);
    return { created: true, awbNumber, productCode, codAmount };

  } catch (e) {
    await Order.updateOne(
      { _id: order._id },
      {
        $set: {
          'shipping.bd.createStatus': 'failed',
          'shipping.bd.createError': e.response?.data || e.message
        }
      }
    );
    await logBD(order._id, 'waybill.create', payload, e.response?.data, e);
    throw e;
  }
}

export async function trackBdAwb(awbNumber) {
  return trackShipment(awbNumber);
}
