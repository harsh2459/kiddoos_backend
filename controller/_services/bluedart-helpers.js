// backend/_services/bluedart-helpers.js

import Order from '../../model/Order.js';
import BlueDartProfile from '../../model/BlueDartProfile.js';
import BlueDartAPI from './bluedart-api.js';

// ✅ Helper 1: Calculate COD amount based on Payment Schema
export function calculateCODAmount(order) {
  // Map Schema fields
  const totalAmount = order.amount || 0;
  const paidAmount = order.payment?.paidAmount || 0;
  const paymentStatus = order.payment?.status || 'pending';
  const dueOnDelivery = order.payment?.dueOnDeliveryAmount || 0;

  // 1. Explicit Due Amount (from Half Payment logic)
  if (dueOnDelivery > 0) {
    return dueOnDelivery;
  }

  // 2. Partially Paid (Fallback)
  if (paymentStatus === 'partially_paid') {
    const due = totalAmount - paidAmount;
    return Math.round(due * 100) / 100;
  }

  // 3. Fully Paid
  if (paymentStatus === 'paid') {
    return 0;
  }

  // 4. Pending (Full COD)
  if (paymentStatus === 'pending') {
    return Math.round(totalAmount * 100) / 100;
  }

  return 0;
}

// ✅ Helper 2: Determine Product Code (A=Prepaid, D=COD)
export function getProductCode(order) {
  const codAmount = calculateCODAmount(order);
  return codAmount > 0 ? 'D' : 'A';
}

// ✅ Helper 3: Get Profile
export async function getProfileOrDefaults(profileId) {
  if (profileId) {
    const profile = await BlueDartProfile.findById(profileId).lean();
    if (profile) return profile;
  }

  // Try default
  let profile = await BlueDartProfile.findOne({ isDefault: true }).lean();
  if (profile) return profile;

  // Try any active
  profile = await BlueDartProfile.findOne({ isActive: true }).lean();
  if (profile) return profile;

  throw new Error('No Blue Dart profile found. Please create one in settings.');
}

// ✅ Helper 4: The Main Shipment Creator
export async function createShipmentForOrder(orderId, profileId = null) {
  try {
    // 1. Get Order with Schema-compliant fields
    const order = await Order.findById(orderId);
    if (!order) throw new Error(`Order not found: ${orderId}`);

    // Check if already shipped
    if (order.shipping?.bd?.awbNumber) {
      throw new Error(`Order ${orderId} already has AWB: ${order.shipping.bd.awbNumber}`);
    }

    const profile = await getProfileOrDefaults(profileId);

    // 2. Calculate Values
    const codAmount = calculateCODAmount(order);
    const productCode = getProductCode(order);

    // ============================================================
    // ✅ CRITICAL FIX: Split Login ID into Area Code & Customer Number
    // ============================================================
    const loginID = (profile.clientName || '').trim();
    // 1. Extract Area Code (First 3 letters)
    let shipperCustomerCode = loginID;
    if (loginID === "SUR96891") {
      shipperCustomerCode = "342311"; // ✅ FORCE CHILD ACCOUNT FOR THIS LOGIN
    }
    const areaCode = 'SUR';

    // 2. Extract Customer Number (The rest of the string)
    // If input is "SUR96891", this becomes "96891"
    const customerCodeNumber = loginID.length > 3 ? loginID.substring(3) : loginID;

    console.log(`🔑 Config: Login=${loginID}, Shipper=${shipperCustomerCode}, Area=${areaCode}`);

    // 3. Prepare Data
    const waybillData = {
      // Pass Credentials & Area Code to API
      creds: {
        licenseKey: profile.shippingKey,
        loginID: loginID,       // Full ID (SUR96891)
        customerCode: loginID, // ONLY the number (96891)
        shipperCode: shipperCustomerCode,
        areaCode: areaCode           // Area (SUR)
      },
      consigner: {
        name: 'BOOK MY STUDY-C/P' || profile.consigner?.name || 'Store',
        address: profile.consigner?.address || '',
        address2: profile.consigner?.address2 || '',
        address3: profile.consigner?.address3 || '',
        pincode: profile.consigner?.pincode || '',
        phone: profile.consigner?.phone || '',
        mobile: profile.consigner?.mobile || '',
        email: profile.consigner?.email || ''
      },
      consignee: {
        // Schema: order.shipping.*
        name: order.shipping?.name || order.customer?.name || 'Customer',
        address: order.shipping?.address || '',
        address2: order.shipping?.area || '',
        address3: order.shipping?.city || '',
        pincode: order.shipping?.pincode || '',
        phone: order.shipping?.phone || '',
        mobile: order.shipping?.phone || '',
        email: order.shipping?.email || order.email || ''
      },
      productCode: productCode,
      weight: order.shipping?.weight || profile.defaults?.weight || 0.5,
      declaredValue: order.amount || 0,
      codAmount: codAmount
    };

    console.log(`📦 Creating Shipment for Order ${orderId.toString().slice(-6)} | Mode: ${productCode} | COD: ${codAmount} | Area: ${areaCode}`);

    // 4. Call API
    const result = await BlueDartAPI.createWaybill(waybillData);

    if (!result.success) {
      throw new Error(result.error || 'BlueDart API failed to create waybill');
    }

    // 5. Update Order
    // We modify the document and save to trigger any mongoose middlewares if present
    order.shipping = order.shipping || {};
    order.shipping.provider = 'bluedart';

    // Ensure nested object exists
    if (!order.shipping.bd) order.shipping.bd = {};

    order.shipping.bd.awbNumber = result.awbNumber;
    order.shipping.bd.tokenNumber = result.tokenNumber;
    order.shipping.bd.codAmount = result.codAmount;
    order.shipping.bd.productCode = productCode; // 'A' or 'D'
    order.shipping.bd.status = 'Booked';
    order.shipping.bd.createdAt = new Date();
    order.shipping.bd.profileId = profile._id;

    // Update main order status
    order.status = 'shipped';

    await order.save();
    console.log('✅ Shipment Saved - AWB:', result.awbNumber);

    return {
      success: true,
      awbNumber: result.awbNumber,
      tokenNumber: result.tokenNumber,
      codAmount: result.codAmount,
      productCode
    };

  } catch (error) {
    console.error(`❌ Shipment Error (${orderId}):`, error.message);
    return { success: false, error: error.message };
  }
}

export default {
  calculateCODAmount,
  getProductCode,
  getProfileOrDefaults,
  createShipmentForOrder
};