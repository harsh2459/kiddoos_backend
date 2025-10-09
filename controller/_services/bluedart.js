// backend/controller/_services/bluedart.js
import axios from 'axios';

// Environment configuration
const BASE_URL = process.env.BLUEDART_BASE_URL || 'https://apigateway.bluedart.com';
const CONSUMER_KEY = process.env.BLUEDART_CONSUMER_KEY;
const CONSUMER_SECRET = process.env.BLUEDART_CONSUMER_SECRET;

// JWT token cache
let jwtToken = null;
let tokenExpiry = null;

/**
 * Generate JWT token from DHL Developer Portal credentials
 * Token is cached and auto-refreshed when expired
 */
async function getJWTToken() {
  // Return cached token if still valid (with 5 min buffer)
  if (jwtToken && tokenExpiry && new Date() < new Date(tokenExpiry.getTime() - 5 * 60 * 1000)) {
    console.log('✅ Using cached JWT token');
    return jwtToken;
  }

  try {
    console.log('🔄 Generating new JWT token...');
    
    if (!CONSUMER_KEY || !CONSUMER_SECRET) {
      throw new Error('BLUEDART_CONSUMER_KEY and BLUEDART_CONSUMER_SECRET must be set in environment variables');
    }

    const { data } = await axios.get(
      `${BASE_URL}/in/transportation/token/v1/login`,
      {
        headers: {
          'ClientID': CONSUMER_KEY,
          'clientSecret': CONSUMER_SECRET
        },
        timeout: 30000
      }
    );

    if (!data || !data.JWTToken) {
      throw new Error('Invalid token response from BlueDart API');
    }

    jwtToken = data.JWTToken;
    // Token valid for 24 hours, set expiry
    tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    
    console.log('✅ JWT token generated successfully');
    return jwtToken;
  } catch (error) {
    console.error('❌ BlueDart JWT generation failed:', error.response?.data || error.message);
    throw new Error(`Failed to authenticate with BlueDart: ${error.response?.data?.message || error.message}`);
  }
}

/**
 * Get headers with JWT token for API calls
 */
async function getAuthHeaders() {
  const token = await getJWTToken();
  return {
    'Content-Type': 'application/json',
    'JWTToken': token
  };
}

/**
 * Create waybill (shipment) with BlueDart APIGEE API
 * @param {Object} payload - Shipment details
 * @param {string} loginId - BlueDart Login ID (Profile.LoginID)
 * @param {string} licenseKey - BlueDart License Key (Profile.LicenceKey)
 * @returns {Object} - AWB number and shipment details
 */
export async function createWaybill(payload, loginId, licenseKey) {
  try {
    const headers = await getAuthHeaders();
    
    // Build APIGEE-compliant request body
    const requestBody = {
      Request: {
        Consignee: {
          ConsigneeAddress1: payload.consignee.address || '',
          ConsigneeAddress2: payload.consignee.address2 || '',
          ConsigneeAddress3: payload.consignee.address3 || '',
          ConsigneePincode: payload.consignee.pincode || '',
          ConsigneeName: payload.consignee.name || '',
          ConsigneeMobile: payload.consignee.mobile || payload.consignee.phone || '',
          ConsigneeTelephone: payload.consignee.phone || '',
          ConsigneeEmailID: payload.consignee.email || '',
          ConsigneeGSTNumber: payload.consignee.gst || ''
        },
        Services: {
          ProductCode: payload.productCode || 'A', // A=Prepaid, D=COD
          ProductType: payload.productType || 2,
          ActualWeight: payload.pieces?.[0]?.weight || 0.5,
          CollectableAmount: payload.codAmount || 0, // COD amount for partial/full COD
          Commodity: {
            CommodityDetail1: payload.commodityDetail || 'General Goods'
          },
          CreditReferenceNo: payload.orderNumber || '',
          CreditReferenceNo2: payload.invoiceNumber || payload.orderNumber || '',
          DeclaredValue: payload.invoiceValue || 0,
          InvoiceNo: payload.invoiceNumber || payload.orderNumber || '',
          PickupDate: payload.pickupDate || `/Date(${Date.now()})/`,
          PickupTime: payload.pickupTime || '1600',
          PieceCount: payload.pieces?.length || 1,
          SpecialInstruction: payload.remarks || '',
          SubProductCode: payload.subProductCode || '',
          VolumetricWeight: payload.pieces?.[0]?.volumetricWeight || 0,
          Dimensions: [{
            Breadth: payload.pieces?.[0]?.breadth || 15,
            Count: 1,
            Height: payload.pieces?.[0]?.height || 3,
            Length: payload.pieces?.[0]?.length || 20
          }]
        },
        Shipper: {
          CustomerAddress1: payload.consigner.address || '',
          CustomerAddress2: payload.consigner.address2 || '',
          CustomerAddress3: payload.consigner.address3 || '',
          CustomerCode: payload.customerCode || '',
          CustomerEmailID: payload.consigner.email || '',
          CustomerMobile: payload.consigner.mobile || payload.consigner.phone || '',
          CustomerName: payload.consigner.name || '',
          CustomerPincode: payload.consigner.pincode || '',
          CustomerTelephone: payload.consigner.phone || '',
          OriginArea: payload.originArea || '',
          Sender: payload.consigner.name || '',
          VendorCode: payload.vendorCode || ''
        }
      },
      Profile: {
        Api_type: 'S',
        LicenceKey: licenseKey,
        LoginID: loginId
      }
    };

    console.log('📦 Creating BlueDart waybill:', {
      orderNumber: payload.orderNumber,
      productCode: payload.productCode,
      codAmount: payload.codAmount
    });

    const { data } = await axios.post(
      `${BASE_URL}/in/transportation/waybill/v1/GenerateWayBill`,
      requestBody,
      { headers, timeout: 30000 }
    );

    // Check for errors in response
    if (data.IsError === true || data.IsError === 'true') {
      throw new Error(data.Status || 'Waybill generation failed');
    }

    console.log('✅ Waybill created successfully:', data.AWBNo);

    return {
      awbNumber: data.AWBNo,
      tokenNumber: data.TokenNumber,
      destinationArea: data.DestinationArea,
      destinationLocation: data.DestinationLocation,
      status: data.Status,
      isError: data.IsError || false
    };
  } catch (error) {
    console.error('❌ BlueDart createWaybill error:', error.response?.data || error.message);
    
    // Handle token expiry - retry once
    if (error.response?.status === 401) {
      console.log('🔄 Token expired, regenerating and retrying...');
      jwtToken = null;
      tokenExpiry = null;
      // Retry once with new token
      return createWaybill(payload, loginId, licenseKey);
    }
    
    throw new Error(`BlueDart API Error: ${error.response?.data?.Status || error.message}`);
  }
}

/**
 * Track shipment by AWB number
 * @param {string} awbNumber - Air Waybill number
 * @param {string} loginId - BlueDart Login ID
 * @param {string} licenseKey - BlueDart License Key
 * @returns {Object} - Tracking details
 */
export async function trackShipment(awbNumber, loginId, licenseKey) {
  try {
    const headers = await getAuthHeaders();

    const requestBody = {
      Request: {
        AWBNo: awbNumber
      },
      Profile: {
        Api_type: 'S',
        LicenceKey: licenseKey,
        LoginID: loginId
      }
    };

    console.log('📍 Tracking shipment:', awbNumber);

    const { data } = await axios.post(
      `${BASE_URL}/in/tracking/shipment/v1/Track`,
      requestBody,
      { headers, timeout: 30000 }
    );

    return data;
  } catch (error) {
    console.error('❌ BlueDart trackShipment error:', error.response?.data || error.message);
    
    // Handle token expiry
    if (error.response?.status === 401) {
      jwtToken = null;
      tokenExpiry = null;
      return trackShipment(awbNumber, loginId, licenseKey);
    }
    
    throw new Error(`BlueDart Tracking Error: ${error.response?.data?.message || error.message}`);
  }
}

/**
 * Schedule pickup for shipments
 * @param {Object} pickupData - Pickup details
 * @param {string} loginId - BlueDart Login ID
 * @param {string} licenseKey - BlueDart License Key
 * @returns {Object} - Pickup confirmation
 */
export async function schedulePickup(pickupData, loginId, licenseKey) {
  try {
    const headers = await getAuthHeaders();

    const requestBody = {
      Request: {
        AreaCode: pickupData.areaCode || '',
        AWBNo: pickupData.awbs || [],
        CISDDN: false,
        ContactPersonName: pickupData.contactPerson || pickupData.customerName || '',
        CustomerAddress1: pickupData.address || '',
        CustomerAddress2: pickupData.address2 || '',
        CustomerAddress3: pickupData.address3 || '',
        CustomerCode: pickupData.customerCode || '',
        CustomerEmailID: pickupData.email || '',
        CustomerMobile: pickupData.mobile || pickupData.phone || '',
        CustomerName: pickupData.customerName || '',
        CustomerPincode: pickupData.pincode || '',
        CustomerTelephone: pickupData.phone || '',
        DoxNDox: pickupData.doxNdox || '1',
        IsForcePickup: pickupData.isForcePickup || false,
        IsReversePickup: pickupData.isReversePickup || false,
        MobileTelNo: pickupData.mobile || pickupData.phone || '',
        NumberofPieces: pickupData.numberOfPieces || 1,
        OfficeCloseTime: pickupData.officeCloseTime || '1800',
        PackType: pickupData.packType || '',
        ProductCode: pickupData.productCode || 'A',
        ReferenceNo: pickupData.referenceNo || '',
        Remarks: pickupData.remarks || '',
        RouteCode: pickupData.routeCode || '',
        ShipmentPickupDate: pickupData.pickupDate || `/Date(${Date.now()})/`,
        ShipmentPickupTime: pickupData.pickupTime || '1600',
        SubProducts: pickupData.subProducts || ['E-Tailing'],
        VolumeWeight: pickupData.volumeWeight || 0.5,
        WeightofShipment: pickupData.weight || 0.5,
        isToPayShipper: pickupData.isToPayShipper || false
      },
      Profile: {
        Api_type: 'S',
        LicenceKey: licenseKey,
        LoginID: loginId
      }
    };

    console.log('📞 Scheduling pickup...');

    const { data } = await axios.post(
      `${BASE_URL}/in/transportation/pickup/v1/RegisterPickup`,
      requestBody,
      { headers, timeout: 30000 }
    );

    if (data.IsError === true || data.IsError === 'true') {
      throw new Error(data.Status || 'Pickup registration failed');
    }

    console.log('✅ Pickup scheduled successfully');

    return {
      tokenNumber: data.TokenNumber,
      status: data.Status,
      pickupRegistrationDate: data.PickupRegistrationDate,
      isError: data.IsError || false
    };
  } catch (error) {
    console.error('❌ BlueDart schedulePickup error:', error.response?.data || error.message);
    
    if (error.response?.status === 401) {
      jwtToken = null;
      tokenExpiry = null;
      return schedulePickup(pickupData, loginId, licenseKey);
    }
    
    throw new Error(`BlueDart Pickup Error: ${error.response?.data?.Status || error.message}`);
  }
}

/**
 * Cancel pickup
 * @param {Object} cancelData - Cancellation details
 * @param {string} loginId - BlueDart Login ID
 * @param {string} licenseKey - BlueDart License Key
 * @returns {Object} - Cancellation confirmation
 */
export async function cancelPickup(cancelData, loginId, licenseKey) {
  try {
    const headers = await getAuthHeaders();

    const requestBody = {
      Request: {
        CancellationToken: cancelData.tokenNumber,
        CancellationReason: cancelData.reason || 'Order cancelled by customer'
      },
      Profile: {
        Api_type: 'S',
        LicenceKey: licenseKey,
        LoginID: loginId
      }
    };

    console.log('🚫 Cancelling pickup:', cancelData.tokenNumber);

    const { data } = await axios.post(
      `${BASE_URL}/in/transportation/pickup/v1/CancelPickup`,
      requestBody,
      { headers, timeout: 30000 }
    );

    return data;
  } catch (error) {
    console.error('❌ BlueDart cancelPickup error:', error.response?.data || error.message);
    
    if (error.response?.status === 401) {
      jwtToken = null;
      tokenExpiry = null;
      return cancelPickup(cancelData, loginId, licenseKey);
    }
    
    throw new Error(`BlueDart Cancel Error: ${error.response?.data?.message || error.message}`);
  }
}

// Export JWT token function for testing/debugging
export { getJWTToken };
