// backend/_services/bluedart-helpers.js

import Order from '../../model/Order.js';
import BlueDartProfile from '../../model/BlueDartProfile.js';
import BlueDartAPI from './bluedart-api.js';
import CloudinaryUploader from './cloudinary-uploader.js';


function formatBlueDartAddress(fullAddress, city) {
  const cleanAddr = (fullAddress || "").replace(/\s+/g, " ").trim();
  
  // BlueDart Limit is usually 30 chars per line
  const limit = 30;
  
  let addr1 = cleanAddr.substring(0, limit);
  let addr2 = cleanAddr.substring(limit, limit * 2);
  let addr3 = city || cleanAddr.substring(limit * 2, limit * 3);

  return { addr1, addr2, addr3 };
}

// ✅ Helper 1: Calculate COD amount based on Payment Schema
export function calculateCODAmount(order) {
  const totalAmount = order.amount || 0;
  const paidAmount = order.payment?.paidAmount || 0;
  const paymentStatus = order.payment?.status || 'pending';
  const dueOnDelivery = order.payment?.dueOnDeliveryAmount || 0;

  if (dueOnDelivery > 0) return dueOnDelivery;
  if (paymentStatus === 'partially_paid') {
    const due = totalAmount - paidAmount;
    return Math.round(due * 100) / 100;
  }
  if (paymentStatus === 'paid') return 0;
  if (paymentStatus === 'pending') return Math.round(totalAmount * 100) / 100;

  return 0;
}

// ✅ Helper 2: Calculate Dimensions strictly from Profile Defaults (No Hardcoding)
export function calculateOrderDimensions(order, profile) {
  // 1. Extract Defaults from Profile (Database)
  const dbWeight = Number(profile?.defaults?.weight) || 0.5;
  const dbLength = Number(profile?.defaults?.length) || 20;
  const dbBreadth = Number(profile?.defaults?.breadth) || 15;
  const dbHeight = Number(profile?.defaults?.height) || 3;

  // 2. Calculate Total Items
  const totalQty = order.items?.reduce((sum, item) => sum + (Number(item.qty) || 1), 0) || 1;

  // 3. Calculate Final Specs
  // Weight: (Qty * DB Weight)
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

  // Height: (Qty * DB Height) + 2cm Packaging Buffer
  const PACKING_BUFFER_CM = 2;
  const calculatedHeight = Math.ceil((totalQty * dbHeight) + PACKING_BUFFER_CM);

  console.log(`📏 [Auto-Calc] Order ${order._id} (Qty: ${totalQty})`);
  console.log(`   - Final Calc: ${calculatedWeight}kg | ${dbLength}x${dbBreadth}x${calculatedHeight}cm`);

  return {
    weight: Math.max(0.5, calculatedWeight), // BlueDart min 0.5kg
    length: dbLength,
    breadth: dbBreadth,
    height: calculatedHeight
  };
}

// ✅ Helper 3: Get Profile
export async function getProfileOrDefaults(profileId) {
  if (profileId) {
    const profile = await BlueDartProfile.findById(profileId).lean();
    if (profile) return profile;
  }
  let profile = await BlueDartProfile.findOne({ isDefault: true }).lean();
  if (profile) return profile;
  profile = await BlueDartProfile.findOne({ isActive: true }).lean();
  if (profile) return profile;
  throw new Error('No Blue Dart profile found. Please create one in settings.');
}

// ✅ Main Shipment Creator
export async function createShipmentForOrder(orderId, profileId = null, options = {}) {
  try {
    // ✅ CRITICAL: Populate 'items.bookId' to get the Book Weight
    const order = await Order.findById(orderId).populate('items.bookId');
    if (!order) throw new Error(`Order not found: ${orderId}`);

    if (order.shipping?.bd?.awbNumber) {
      throw new Error(`Order ${orderId} already has AWB: ${order.shipping.bd.awbNumber}`);
    }

    const profile = await getProfileOrDefaults(profileId);
    const codAmount = calculateCODAmount(order);
    
    // ✅ FIX APPLIED HERE: Always use 'A' (Air/Apex)
    // The API will automatically set SubProductCode to 'C' if codAmount > 0
    const productCode = 'A';

    // Child Account Logic
    const loginID = (profile.clientName || '').trim();
    let shipperCustomerCode = loginID;
    if (loginID === "SUR96891") {
      shipperCustomerCode = "342311";
    }
    const areaCode = 'SUR';
    
    const fullAddress = order.shipping?.address || '';
    const city = order.shipping?.city || '';
    const { addr1, addr2, addr3 } = formatBlueDartAddress(fullAddress, city);

    // ✅ Get Dimensions from Profile
    const specs = calculateOrderDimensions(order, profile);

    const waybillData = {
      creds: {
        licenseKey: profile.shippingKey,
        loginID: loginID,
        customerCode: loginID,
        shipperCode: shipperCustomerCode,
        areaCode: areaCode
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
        name: order.shipping?.name || order.customer?.name || 'Customer',
        address: addr1 || '',
        address2: addr2 || '',
        address3: addr3 || '',
        pincode: order.shipping?.pincode || '',
        phone: order.shipping?.phone || '',
        mobile: order.shipping?.phone || '',
        email: order.shipping?.email || order.email || ''
      },
      productCode: productCode,
      weight: specs.weight,
      declaredValue: order.amount || 500,
      codAmount: codAmount,
      services: {
        ActualWeight: specs.weight,
        Dimensions: [{
          Length: specs.length,
          Breadth: specs.breadth,
          Height: specs.height,
          Count: 1
        }]
      }
    };

    console.log('📤 [HELPER] Sending to BlueDart API:', JSON.stringify(waybillData.services, null, 2));

    // 1. CALL CREATE WAYBILL API
    const result = await BlueDartAPI.createWaybill(waybillData);

    if (!result.success) {
      throw new Error(result.error || 'BlueDart API failed to create waybill');
    }

    // 2. UPLOAD LABEL TO CLOUDINARY
    let labelUrl = null;
    let labelStatus = 'failed';

    if (result.awbPrintContent) {
      try {
        console.log(`☁️ Uploading label for AWB ${result.awbNumber}...`);
        
        let pdfBuffer;
        if (Buffer.isBuffer(result.awbPrintContent)) {
          pdfBuffer = result.awbPrintContent;
        } else if (Array.isArray(result.awbPrintContent)) {
          pdfBuffer = Buffer.from(result.awbPrintContent);
        } else {
          pdfBuffer = Buffer.from(result.awbPrintContent, 'base64');
        }

        const uploadResult = await CloudinaryUploader.uploadBuffer(
          pdfBuffer,
          `label-${result.awbNumber}`,
          'shipping-labels'
        );

        labelUrl = uploadResult.secure_url;
        labelStatus = 'generated';
        console.log(`✅ Label uploaded: ${labelUrl}`);
      } catch (uploadErr) {
        console.error('❌ Cloudinary Upload Failed:', uploadErr);
      }
    }

    // 3. UPDATE ORDER IN DB
    order.shipping = order.shipping || {};
    order.shipping.provider = 'bluedart';
    if (!order.shipping.bd) order.shipping.bd = {};

    order.shipping.bd.awbNumber = result.awbNumber;
    order.shipping.bd.tokenNumber = result.tokenNumber;
    order.shipping.bd.codAmount = result.codAmount;
    order.shipping.bd.productCode = productCode;
    order.shipping.bd.status = 'Booked';
    order.shipping.bd.createdAt = new Date();
    order.shipping.bd.profileId = profile._id;

    order.shipping.bd.dimensions = {
      length: specs.length,
      breadth: specs.breadth,
      height: specs.height,
      weight: specs.weight
    };

    order.shipping.bd.labelUrl = labelUrl;
    order.shipping.bd.labelStatus = labelStatus;
    order.shipping.bd.labelGeneratedAt = new Date();

    order.status = 'shipped';

    await order.save();
    console.log('✅ Shipment Saved - AWB:', result.awbNumber);

    return {
      success: true,
      awbNumber: result.awbNumber,
      labelUrl: labelUrl
    };

  } catch (error) {
    console.error(`❌ Shipment Error (${orderId}):`, error.message);
    return { success: false, error: error.message };
  }
}

export default {
  calculateCODAmount,
  calculateOrderDimensions,
  getProfileOrDefaults,
  createShipmentForOrder
};