// backend/controller/_services/bdOrdershelper.js
import User from '../../model/User.js';
import Order from '../../model/Order.js';
import BlueDartProfile from '../../model/BlueDartProfile.js';
import { createWaybill, trackShipment } from './bluedart.js';

/**
 * Find Blue Dart owner user ID
 */
export async function findBdOwnerUserId() {
  // Try to find admin with active Blue Dart integration first
  let u = await User.findOne({ 
    role: 'admin', 
    'integrations.bluedart.active': true 
  }).select('_id').lean();
  
  if (u?._id) return u._id;

  // Fallback: Find any admin user
  u = await User.findOne({ role: 'admin' }).select('_id').lean();
  
  if (u?._id) {
    if (!global.bluedartWarningShown) {
      console.log('⚠️  Blue Dart integration not configured, using fallback admin');
      global.bluedartWarningShown = true;
    }
    return u._id;
  }

  // Last resort: Find any user
  u = await User.findOne().select('_id').lean();
  
  if (u?._id) {
    if (!global.bluedartWarningShown) {
      console.log('⚠️  No admin found, using first available user');
      global.bluedartWarningShown = true;
    }
    return u._id;
  }

  throw new Error('No users found in database');
}

/**
 * Get BlueDart profile or defaults
 */
async function getProfileOrDefaults(profileId) {
  if (profileId) {
    const profile = await BlueDartProfile.findById(profileId).lean();
    if (profile) {
      return profile;
    }
  }

  // Try to get default profile
  const defaultProfile = await BlueDartProfile.findOne({ isDefault: true }).lean();
  if (defaultProfile) {
    return defaultProfile;
  }

  // Get any profile
  const anyProfile = await BlueDartProfile.findOne().lean();
  if (anyProfile) {
    return anyProfile;
  }

  throw new Error('No BlueDart profile found. Please create one first.');
}

/**
 * Calculate COD amount for partial payments
 * @param {Object} order - Order object
 * @returns {number} - COD amount to collect
 */
function calculateCODAmount(order) {
  const totalAmount = order.totalAmount || 0;
  const paidAmount = order.paidAmount || 0;
  const paymentStatus = order.paymentStatus;

  // If partially paid, COD = remaining amount
  if (paymentStatus === 'partially_paid') {
    const codAmount = totalAmount - paidAmount;
    console.log(`💰 Order ${order.orderNumber}: Partial payment - Total: ₹${totalAmount}, Paid: ₹${paidAmount}, COD: ₹${codAmount}`);
    return codAmount > 0 ? Math.round(codAmount * 100) / 100 : 0;
  }

  // If fully paid online, no COD
  if (paymentStatus === 'paid') {
    console.log(`💳 Order ${order.orderNumber}: Fully paid online - COD: ₹0`);
    return 0;
  }

  // If not paid (COD order), collect full amount
  if (paymentStatus === 'pending') {
    console.log(`💵 Order ${order.orderNumber}: Full COD - Amount: ₹${totalAmount}`);
    return Math.round(totalAmount * 100) / 100;
  }

  return 0;
}

/**
 * Determine product code based on payment status
 * @param {Object} order - Order object
 * @returns {string} - 'A' for prepaid, 'D' for COD
 */
function getProductCode(order) {
  const codAmount = calculateCODAmount(order);

  // If there's any COD amount to collect, use COD product
  if (codAmount > 0) {
    return 'D'; // COD product
  }

  // Fully paid online
  return 'A'; // Prepaid product
}

/**
 * Create BlueDart shipment for an order
 * @param {Object} order - Order object
 * @param {Object} profile - BlueDart profile with credentials
 * @returns {Object} - Shipment details with AWB
 */
export async function createBdForOrder(order, profile) {
  try {
    // Calculate COD amount
    const codAmount = calculateCODAmount(order);
    const productCode = getProductCode(order);

    console.log(`📦 Creating shipment for order ${order.orderNumber}:`, {
      paymentStatus: order.paymentStatus,
      totalAmount: order.totalAmount,
      paidAmount: order.paidAmount,
      codAmount,
      productCode
    });

    // Prepare waybill payload
    const payload = {
      orderNumber: order.orderNumber || order._id.toString(),
      invoiceNumber: order.invoiceNumber || order.orderNumber || order._id.toString(),
      invoiceValue: order.totalAmount || 0,
      codAmount: codAmount, // ← IMPORTANT: Send remaining amount as COD
      productCode: productCode, // 'D' if COD amount > 0, else 'A'
      productType: 2,
      customerCode: profile.consigner?.customerCode || profile.clientName || '',

      // Consigner (your business address)
      consigner: {
        name: profile.consigner?.name || 'Store',
        address: profile.consigner?.address || '',
        address2: profile.consigner?.address2 || '',
        address3: profile.consigner?.address3 || '',
        city: profile.consigner?.city || '',
        state: profile.consigner?.state || '',
        pincode: profile.consigner?.pincode || '',
        phone: profile.consigner?.phone || '',
        mobile: profile.consigner?.mobile || profile.consigner?.phone || '',
        email: profile.consigner?.email || ''
      },

      // Consignee (customer address)
      consignee: {
        name: order.shippingAddress?.name || order.customerName || 'Customer',
        address: order.shippingAddress?.address || '',
        address2: order.shippingAddress?.address2 || '',
        address3: order.shippingAddress?.landmark || '',
        city: order.shippingAddress?.city || '',
        state: order.shippingAddress?.state || '',
        pincode: order.shippingAddress?.pincode || '',
        phone: order.shippingAddress?.phone || '',
        mobile: order.shippingAddress?.mobile || order.shippingAddress?.phone || '',
        email: order.customerEmail || ''
      },

      // Package details
      pieces: [{
        weight: profile.defaults?.weight || 0.5,
        length: profile.defaults?.length || 20,
        breadth: profile.defaults?.breadth || 15,
        height: profile.defaults?.height || 3,
        volumetricWeight: ((profile.defaults?.length || 20) * (profile.defaults?.breadth || 15) * (profile.defaults?.height || 3)) / 5000
      }],

      pickupDate: `/Date(${Date.now()})/`,
      pickupTime: '1600',
      remarks: codAmount > 0 ? `Partial payment. Collect ₹${codAmount} as COD.` : 'Prepaid shipment',
      commodityDetail: 'General Goods'
    };

    // Create waybill with BlueDart
    const result = await createWaybill(
      payload,
      profile.clientName, // LoginID
      profile.shippingKey  // LicenseKey
    );

    return {
      success: true,
      awbNumber: result.awbNumber,
      tokenNumber: result.tokenNumber,
      codAmount: codAmount,
      productCode: productCode,
      destinationArea: result.destinationArea,
      destinationLocation: result.destinationLocation
    };

  } catch (error) {
    console.error(`❌ Failed to create shipment for ${order.orderNumber}:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Track BlueDart AWB
 * @param {string} awbNumber - AWB number to track
 * @param {string} profileId - BlueDart profile ID
 * @returns {Object} - Tracking details
 */
export async function trackBdAwb(awbNumber, profileId) {
  try {
    const profile = await getProfileOrDefaults(profileId);

    const result = await trackShipment(
      awbNumber,
      profile.clientName, // LoginID
      profile.trackingKey || profile.shippingKey // Use trackingKey if available, fallback to shippingKey
    );

    return {
      success: true,
      tracking: result
    };

  } catch (error) {
    console.error(`❌ Failed to track AWB ${awbNumber}:`, error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Create shipments for multiple orders
 * @param {Array} orders - Array of order objects
 * @param {Object} profile - BlueDart profile
 * @returns {Object} - Results with success and failed arrays
 */
export async function createBulkShipments(orders, profile) {
  const results = {
    success: [],
    failed: []
  };

  for (const order of orders) {
    const result = await createBdForOrder(order, profile);

    if (result.success) {
      results.success.push({
        orderId: order._id,
        orderNumber: order.orderNumber,
        awbNumber: result.awbNumber,
        codAmount: result.codAmount,
        productCode: result.productCode
      });
    } else {
      results.failed.push({
        orderId: order._id,
        orderNumber: order.orderNumber,
        error: result.error
      });
    }
  }

  return results;
}
