// backend/_services/bluedart-helpers.js

import Order from '../../model/Order.js';
import BlueDartProfile from '../../model/BlueDartProfile.js';
import BlueDartAPI from './bluedart-api.js';

export function calculateCODAmount(order) {
  const totalAmount = order.totalAmount || 0;
  const paidAmount = order.paidAmount || 0;
  const paymentStatus = order.paymentStatus;

  if (paymentStatus === 'partially_paid') {
    return Math.round((totalAmount - paidAmount) * 100) / 100;
  }
  if (paymentStatus === 'paid') return 0;
  if (paymentStatus === 'pending') return Math.round(totalAmount * 100) / 100;
  return 0;
}

export function getProductCode(order) {
  const codAmount = calculateCODAmount(order);
  return codAmount > 0 ? 'D' : 'A';
}

export async function getProfileOrDefaults(profileId) {
  try {
    if (profileId) {
      const profile = await BlueDartProfile.findById(profileId).lean();
      if (profile) return profile;
    }

    let profile = await BlueDartProfile.findOne({ isDefault: true }).lean();
    if (profile) return profile;

    profile = await BlueDartProfile.findOne({ isActive: true }).lean();
    if (profile) return profile;

    throw new Error('No Blue Dart profile found');
  } catch (error) {
    throw error;
  }
}

export async function createShipmentForOrder(orderId, profileId = null) {
  try {
    console.log('📦 Creating shipment:', orderId);

    const order = await Order.findById(orderId).populate('shippingAddress');
    if (!order) throw new Error(`Order not found: ${orderId}`);

    const profile = await getProfileOrDefaults(profileId);
    const codAmount = calculateCODAmount(order);
    const productCode = getProductCode(order);

    const waybillData = {
      orderNumber: order.orderNumber || order._id.toString(),
      customerCode: profile.clientName || 'STORE001',
      loginId: profile.clientName,
      originArea: 'MUM',
      commodity: 'Mixed Items',
      consigner: {
        name: profile.consigner?.name || 'Store',
        address: profile.consigner?.address || '',
        address2: profile.consigner?.address2 || '',
        address3: profile.consigner?.address3 || '',
        pincode: profile.consigner?.pincode || '',
        phone: profile.consigner?.phone || '',
        mobile: profile.consigner?.mobile || '',
        email: profile.consigner?.email || ''
      },
      consignee: {
        name: order.shippingAddress?.fullName || 'Customer',
        address: order.shippingAddress?.addressLine1 || '',
        address2: order.shippingAddress?.addressLine2 || '',
        address3: order.shippingAddress?.landmark || '',
        pincode: order.shippingAddress?.pincode || '',
        phone: order.shippingAddress?.phone || '',
        mobile: order.shippingAddress?.mobile || '',
        email: order.email || ''
      },
      services: {
        productCode,
        weight: profile.defaults?.weight || 0.5,
        declaredValue: order.totalAmount,
        codAmount,
        pickupDate: new Date()
      }
    };

    const result = await BlueDartAPI.createWaybill(waybillData);

    order.shipping = order.shipping || {};
    order.shipping.blueDart = {
      awbNumber: result.awbNo,
      tokenNumber: result.tokenNumber,
      status: 'Booked',
      productCode,
      codAmount,
      bookedAt: new Date()
    };

    await order.save();
    console.log('✅ Created - AWB:', result.awbNo);

    return {
      success: true,
      awbNo: result.awbNo,
      tokenNumber: result.tokenNumber,
      codAmount,
      productCode
    };

  } catch (error) {
    console.error('❌ Failed:', error.message);
    return { success: false, error: error.message };
  }
}

export async function trackShipmentStatus(awbNo) {
  try {
    return await BlueDartAPI.trackShipment(awbNo);
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export default {
  calculateCODAmount,
  getProductCode,
  getProfileOrDefaults,
  createShipmentForOrder,
  trackShipmentStatus
};
