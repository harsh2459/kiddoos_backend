// backend/_services/bluedart-helpers.js

import Order from '../../model/Order.js';
import BlueDartProfile from '../../model/BlueDartProfile.js';
import BlueDartAPI from './bluedart-api.js';
import * as DriveUploader from './drive-uploader.js';
import * as CloudinaryUploader from './cloudinary-uploader.js';
import BlueDartLabel from './bluedart-label.js';

function formatBlueDartAddress(fullAddress, city) {
  const cleanAddr = (fullAddress || "").replace(/\s+/g, " ").trim();
  const limit = 30;
  let addr1 = cleanAddr.substring(0, limit);
  let addr2 = cleanAddr.substring(limit, limit * 2);
  let addr3 = city || cleanAddr.substring(limit * 2, limit * 3);
  return { addr1, addr2, addr3 };
}

// ✅ Helper 1: Calculate COD amount
export function calculateCODAmount(order) {
  const dueOnDelivery = order.payment?.dueOnDeliveryAmount || 0;
  if (dueOnDelivery > 0) return dueOnDelivery;

  const paymentStatus = order.payment?.status || 'pending';
  if (paymentStatus === 'partially_paid') {
    return Math.max(0, (order.amount || 0) - (order.payment?.paidAmount || 0));
  }
  if (paymentStatus === 'paid') return 0;

  return order.amount || 0;
}

// ✅ Helper 2: Calculate Dimensions
export function calculateOrderDimensions(order, profile) {
  const dbWeight = Number(profile?.defaults?.weight) || 0.3;
  const dbLength = Number(profile?.defaults?.length) || 20;
  const dbBreadth = Number(profile?.defaults?.breadth) || 15;
  const dbHeight = Number(profile?.defaults?.height) || 3;

  const totalQty = order.items?.reduce((sum, item) => sum + (Number(item.qty) || 1), 0) || 1;

  let totalWeight = 0;
  if (order.items && order.items.length > 0) {
    totalWeight = order.items.reduce((sum, item) => {
      const qty = Number(item.qty) || 1;
      const itemWeight = Number(item.bookId?.weight) > 0 ? Number(item.bookId.weight) : dbWeight;
      return sum + (itemWeight * qty);
    }, 0);
  } else {
    totalWeight = dbWeight;
  }

  const calculatedWeight = Number(totalWeight.toFixed(2));
  const PACKING_BUFFER_CM = 2;
  const calculatedHeight = Math.ceil((totalQty * dbHeight) + PACKING_BUFFER_CM);

  return {
    weight: Math.max(0.5, calculatedWeight),
    length: dbLength,
    breadth: dbBreadth,
    height: calculatedHeight
  };
}

export async function getProfileOrDefaults(profileId) {
  if (profileId) {
    const profile = await BlueDartProfile.findById(profileId).lean();
    if (profile) return profile;
  }
  let profile = await BlueDartProfile.findOne({ isDefault: true }).lean();
  if (profile) return profile;
  profile = await BlueDartProfile.findOne({ isActive: true }).lean();
  if (profile) return profile;
  throw new Error('No Blue Dart profile found.');
}

// ✅ Main Shipment Creator
export async function createShipmentForOrder(orderId, profileId = null) {
  try {
    // 1. Fetch Order with Books to get SKU
    const order = await Order.findById(orderId).populate('items.bookId');
    if (!order) throw new Error(`Order not found: ${orderId}`);

    if (order.shipping?.bd?.awbNumber) {
      throw new Error(`Order ${orderId} already has AWB: ${order.shipping.bd.awbNumber}`);
    }

    const profile = await getProfileOrDefaults(profileId);
    const codAmount = calculateCODAmount(order);
    const productCode = codAmount > 0 ? 'D' : 'A'; // Auto-switch based on COD

    const loginID = (profile.clientName || '').trim();
    let shipperCustomerCode = loginID === "SUR96891" ? "342311" : loginID;

    const fullAddress = order.shipping?.address || '';
    const city = order.shipping?.city || '';
    const { addr1, addr2, addr3 } = formatBlueDartAddress(fullAddress, city);
    const specs = calculateOrderDimensions(order, profile);

    const waybillData = {
      creds: {
        licenseKey: profile.shippingKey,
        loginID: loginID,
        customerCode: loginID,
        shipperCode: shipperCustomerCode,
        areaCode: 'SUR'
      },
      consigner: {
        name: profile.consigner?.name || 'BOOK MY STUDY-C/P',
        address: profile.consigner?.address || '',
        address2: profile.consigner?.address2 || '',
        address3: profile.consigner?.address3 || '',
        pincode: profile.consigner?.pincode || '',
        phone: profile.consigner?.phone || '',
        mobile: profile.consigner?.mobile || '',
        email: profile.consigner?.email || ''
      },
      consignee: {
        name: order.shipping?.name || 'Customer',
        address: addr1,
        address2: addr2,
        address3: addr3,
        pincode: order.shipping?.pincode || '',
        phone: order.shipping?.phone || '',
        mobile: order.shipping?.phone || '',
        email: order.shipping?.email || ''
      },
      productCode: productCode,
      weight: specs.weight,
      declaredValue: order.amount || 500,
      codAmount: codAmount,
      services: {
        ActualWeight: specs.weight,
        Dimensions: [{ Length: specs.length, Breadth: specs.breadth, Height: specs.height, Count: 1 }]
      }
    };

    // 2. Call API
    const result = await BlueDartAPI.createWaybill(waybillData);
    if (!result.success) throw new Error(result.error || 'Waybill failed');

    // ============================================================
    // ✅ PREPARE DATA FOR CUSTOM LABEL (Including SKU)
    // ============================================================

    const orderItems = order.items.map(item => ({
      title: item.bookId?.title || item.title || 'Book',
      sku: item.bookId?.inventory?.sku || 'N/A',
      qty: item.qty
    }));

    const labelData = {
      awbNumber: result.awbNumber,
      productCode: productCode,
      codAmount: result.codAmount,
      declaredValue: waybillData.declaredValue,
      weight: specs.weight,
      items: orderItems, // 👈 PASSING SKUs HERE
      consigner: { ...waybillData.consigner, city: 'Surat' },
      consignee: { ...waybillData.consignee, city: city }
    };

    let labelUrl = null;
    let labelStatus = 'failed';

    try {
      console.log('🏭 Generating Label with Logo & SKU...');
      const savedLabel = await BlueDartLabel.generateCustomLabel(labelData);

      if (savedLabel.success) {
        try {
          // Upload to Drive
          const DRIVE_FOLDER_ID = '1otZweZ_5kBQA2B0uqM5EdOnFvSaVRM9Z';
          const driveRes = await DriveUploader.uploadBuffer(savedLabel.buffer, savedLabel.fileName, DRIVE_FOLDER_ID);
          labelUrl = driveRes.url;
          labelStatus = 'generated';
        } catch (driveError) {
          // Backup to Cloudinary
          try {
            const cloudRes = await CloudinaryUploader.uploadBuffer(savedLabel.buffer, result.awbNumber);
            labelUrl = cloudRes.secure_url;
            labelStatus = 'generated';
          } catch (e) {
            labelUrl = `/uploads/labels/${savedLabel.fileName}`;
          }
        }
      }
    } catch (err) {
      console.error('Label Gen Failed:', err.message);
    }

    // 3. Update Order
    order.shipping = order.shipping || {};
    order.shipping.bd = order.shipping.bd || {};
    order.shipping.bd.awbNumber = result.awbNumber;
    order.shipping.bd.tokenNumber = result.tokenNumber;
    order.shipping.bd.codAmount = result.codAmount;
    order.shipping.bd.productCode = productCode;
    order.shipping.bd.status = 'Booked';
    order.shipping.bd.labelUrl = labelUrl;
    order.shipping.bd.labelStatus = labelStatus;
    order.shipping.bd.labelGeneratedAt = new Date();
    order.status = 'shipped';

    await order.save();

    await sendBySlug(
      "order_shipped",
      order.shipping.email,
      {
        name: order.shipping.name,
        order_id: order._id,
        awb: order.shipping.bd.awbNumber,
        courier: "BlueDart",
        tracking_url: `https://www.bluedart.com/tracking?awb=${order.shipping.bd.awbNumber}`
      }
    );
    console.log('✅ Shipment Created:', result.awbNumber);

    return { success: true, awbNumber: result.awbNumber, labelUrl: labelUrl };

  } catch (error) {
    console.error(`❌ Shipment Error:`, error.message);
    return { success: false, error: error.message };
  }
}

export default {
  calculateCODAmount,
  calculateOrderDimensions,
  getProfileOrDefaults,
  createShipmentForOrder
};