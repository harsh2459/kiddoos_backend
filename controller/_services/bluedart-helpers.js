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
  let addr3 = city || cleanAddr.substring(limit * 2, limit * 3); // Use City in Line 3 if available

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

// ✅ Helper 2: Determine Product Code (A=Prepaid, D=COD)
export function getProductCode(order) {
  return 'A'
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

// ✅ Helper 4: The Main Shipment Creator (FIXED DIMENSIONS)
export async function createShipmentForOrder(orderId, profileId = null, options = {}) {
  try {
    const order = await Order.findById(orderId);
    if (!order) throw new Error(`Order not found: ${orderId}`);

    if (order.shipping?.bd?.awbNumber) {
      throw new Error(`Order ${orderId} already has AWB: ${order.shipping.bd.awbNumber}`);
    }

    const profile = await getProfileOrDefaults(profileId);
    const codAmount = calculateCODAmount(order);
    const productCode = getProductCode(order);

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
    // ✅ FIXED: Parse dimensions from options with proper fallbacks
    const length = Number(options.length) || 20;
    const breadth = Number(options.breadth) || 15;
    const height = Number(options.height) || 5;
    const weight = Number(options.weight) || order.shipping?.weight || 0.5;

    console.log('📦 [HELPER] Dimensions received:', { length, breadth, height, weight });

    const consigner = {
      name: profile.consigner?.name || 'BOOK MY STUDY-C/P',
      address: profile.consigner?.address || '',
      address2: profile.consigner?.address2 || '',
      address3: profile.consigner?.address3 || '',
      pincode: profile.consigner?.pincode || '',
      phone: profile.consigner?.phone || '',
      mobile: profile.consigner?.mobile || '',
      email: profile.consigner?.email || ''
    };

    const waybillData = {
      creds: {
        licenseKey: profile.shippingKey,
        loginID: loginID,
        customerCode: loginID,
        shipperCode: shipperCustomerCode,
        areaCode: areaCode
      },
      consigner: consigner,
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
      weight: weight,  // ✅ Use parsed weight
      declaredValue: order.amount || 0,
      codAmount: codAmount,
      // ✅ FIXED: Pass dimensions explicitly
      services: {
        ActualWeight: weight,
        Dimensions: [{
          Length: length,
          Breadth: breadth,
          Height: height,
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
        console.log(`☁️ Uploading label for AWB ${result.awbNumber} to Cloudinary...`);
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
    order.shipping.bd.productCode = getProductCode(order);
    order.shipping.bd.status = 'Booked';
    order.shipping.bd.createdAt = new Date();
    order.shipping.bd.profileId = profile._id;

    // ✅ SAVE DIMENSIONS IN DATABASE
    order.shipping.bd.dimensions = {
      length: length,
      breadth: breadth,
      height: height,
      weight: weight
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
  getProductCode,
  getProfileOrDefaults,
  createShipmentForOrder
};