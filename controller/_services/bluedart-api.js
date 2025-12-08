// backend/_services/bluedart-api.js

import axios from 'axios';
import BlueDartAuth from './bluedart-auth.js';
import { BD_CONFIG } from './bluedart-config.js';

class BlueDartAPI {
  constructor() {
    this.baseUrl = process.env.BLUEDART_BASE_URL;
    this.retryCount = 3;
    this.retryDelay = 1000;
  }

  formatDate(date) {
    const d = new Date(date);
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
  }

  formatTime(time) {
    if (typeof time === 'string' && /^\d{4}$/.test(time)) {
      return time;
    }
    const t = new Date(time);
    return `${String(t.getHours()).padStart(2, '0')}${String(t.getMinutes()).padStart(2, '0')}`;
  }

  async apiCall(method, endpoint, data = null, retryAttempt = 0) {
    try {
      const headers = await BlueDartAuth.getAuthHeaders();
      const config = {
        method,
        url: `${this.baseUrl}${endpoint}`,
        headers,
        timeout: 30000,
        validateStatus: () => true
      };

      if (data && (method === 'POST' || method === 'PUT')) {
        config.data = data;
      }

      const response = await axios(config);

      if (response.status === 401) {
        await BlueDartAuth.refreshToken();
        if (retryAttempt < this.retryCount) {
          return this.apiCall(method, endpoint, data, retryAttempt + 1);
        }
      }

      if (response.status >= 500) {
        if (retryAttempt < this.retryCount) {
          await new Promise(resolve => setTimeout(resolve, this.retryDelay * Math.pow(2, retryAttempt)));
          return this.apiCall(method, endpoint, data, retryAttempt + 1);
        }
      }

      return response.data;
    } catch (error) {
      console.error(`❌ API Call Error [${method} ${endpoint}]:`, error.message);
      throw error;
    }
  }

  // ✅ 1. CREATE WAYBILL (With Detailed Logs)
  async createWaybill(data) {
    try {
            // 🔍 DEBUG LOG 1: Check Input Amounts
      const codAmount = Number(data.codAmount) || 0;
      const subProductCode = codAmount > 0 ? 'C' : 'P';

      console.log(`💰 [COD CHECK] Input: ${data.codAmount} | Parsed: ${codAmount} | SubProduct: ${subProductCode}`);

      // ✅ EXTRACT DIMENSIONS FROM data.services (passed from helper)
      const dimensions = data.services?.Dimensions || [{ Length: 20, Breadth: 15, Height: 5, Count: 1 }];
      const actualWeight = data.services?.ActualWeight || data.weight || 0.5;

      console.log('📏 [API] Using dimensions:', dimensions);
      console.log('⚖️ [API] Using weight:', actualWeight);

      const payload = {
        Request: {
          Consignee: {
            ConsigneeName: data.consignee.name,
            ConsigneeAddress1: data.consignee.address,
            ConsigneeAddress2: data.consignee.address2 || '',
            ConsigneeAddress3: data.consignee.address3 || '',
            ConsigneePincode: data.consignee.pincode,
            ConsigneeMobile: data.consignee.mobile,
            ConsigneeEmailID: data.consignee.email,
            ConsigneeTelephone: data.consignee.phone || ''
          },
          Shipper: {
            CustomerCode: data.creds.shipperCode || data.creds.customerCode,
            CustomerName: data.consigner.name,
            CustomerAddress1: data.consigner.address,
            CustomerAddress2: data.consigner.address2 || '',
            CustomerAddress3: data.consigner.address3 || '',
            CustomerPincode: data.consigner.pincode,
            CustomerMobile: data.consigner.mobile,
            CustomerEmailID: data.consigner.email,
            CustomerTelephone: data.consigner.phone || '',
            OriginArea: data.creds.areaCode,
            IsToPayCustomer: false
          },
          Services: {
            ProductCode: data.productCode || 'E',
            ProductType: 2,

            // ✅ Dynamic SubProduct (C or P)
            SubProductCode: subProductCode,

            PieceCount: 1,

            // ✅ USE ACTUAL WEIGHT FROM HELPER
            ActualWeight: actualWeight,

            DeclaredValue: data.declaredValue || 0,

            // ✅ Ensure correct amount is sent
            CollectableAmount: codAmount,

            CreditReferenceNo: Date.now().toString(),
            PickupDate: `/Date(${Date.now()})/`,
            PickupTime: '1600',
            PDFOutputNotRequired: false,
            RegisterPickup: false,
            IsForcePickup: false,

            // ✅ USE DIMENSIONS FROM HELPER
            Dimensions: dimensions,

            ItemCount: 1,
            Commodity: { CommodityDetail1: 'Books', CommodityDetail2: '', CommodityDetail3: '' }
          },
          Returnadds: {
            ReturnAddress1: data.consigner.address || '',
            ReturnAddress2: data.consigner.address2 || '',
            ReturnAddress3: data.consigner.address3 || '',
            ReturnPincode: data.consigner.pincode || '',
            ReturnMobile: data.consigner.mobile || '',
            ReturnEmailID: data.consigner.email || ''
          }
        },
        Profile: {
          Api_type: 'S',
          Area: data.creds.areaCode,
          Customercode: data.creds.loginID,
          LicenceKey: data.creds.licenseKey,
          LoginID: data.creds.loginID,
          Version: '1.3',
          IsAdmin: ''
        }
      };



      const result = await this.apiCall('POST', BD_CONFIG.endpoints.waybill, payload);

      

      const output = result.GenerateWayBillResult || result;

      // Extract AWB
      let awbNumber = output.AWBNO || output.WaybillNo;

      if (!awbNumber && output.MPSDetails && Array.isArray(output.MPSDetails) && output.MPSDetails.length > 0) {
        const mpsString = output.MPSDetails[0].MPSNumber;
        if (mpsString) awbNumber = mpsString.split('-')[0];
      }

      if (awbNumber) {
        return {
          success: true,
          awbNumber: awbNumber,
          tokenNumber: output.TokenNumber || '',
          codAmount: codAmount,
          awbPrintContent: output.AWBPrintContent
        };
      }

      let errorMsg = 'Waybill creation failed';
      if (result['error-response']?.[0]?.Status?.[0]?.StatusInformation) {
        errorMsg = result['error-response'][0].Status[0].StatusInformation;
      } else if (output.Status && Array.isArray(output.Status)) {
        errorMsg = output.Status[0].StatusInformation;
      }
      throw new Error(errorMsg);

    } catch (error) {
      console.error('❌ Waybill error:', error.message);
      return { success: false, error: error.message };
    }
  }

  // ✅ 2. TRACK SHIPMENT
  async trackShipment(awbNumber) {
    try {
      console.log('🔍 [API] Tracking shipment:', awbNumber);
      const result = await this.apiCall('GET', `/in/transportation/tracking/v1/${awbNumber}`);
      if (result.TrackingOutput?.IsError === 'false') {
        return {
          success: true,
          status: result.TrackingOutput.Status || 'Booked',
          currentLocation: result.TrackingOutput.CurrentLocation || '',
          lastUpdate: result.TrackingOutput.LastUpdate || new Date()
        };
      }
      return { success: false, status: 'Not Found' };
    } catch (error) {
      console.error('❌ Tracking error:', error.message);
      throw error;
    }
  }

  // ✅ 3. TRANSIT TIME
  async getTransitTime(data) {
    try {
      console.log('⏱️ [API] Getting transit time...');
      const payload = {
        Request: {
          OriginPinCode: data.fromPincode,
          DestinationPinCode: data.toPincode,
          ProductCode: data.productCode || 'A',
          PickupDate: this.formatDate(data.pickupDate || new Date())
        }
      };
      const result = await this.apiCall('POST', '/in/transportation/transittime/v1', payload);
      if (result.TransitTimeOutput?.IsError === 'false') {
        return {
          success: true,
          estimatedDays: result.TransitTimeOutput.EstimatedDays || 'N/A',
          deliveryDate: result.TransitTimeOutput.EstimatedDeliveryDate || '',
          status: result.TransitTimeOutput.Status || 'Success'
        };
      }
      throw new Error(result.TransitTimeOutput?.Status || 'Transit time calculation failed');
    } catch (error) {
      console.error('❌ Transit time error:', error.message);
      return { success: false, error: error.message, estimatedDays: 'N/A' };
    }
  }

  // ✅ 4. SCHEDULE PICKUP (Logs Added)
  async schedulePickup(data) {
    try {
      console.log('📦 [API] Scheduling pickup with data:', JSON.stringify(data, null, 2));

      let pDate = new Date(data.pickupDate);
      if (isNaN(pDate.getTime())) {
        pDate = new Date();
        pDate.setDate(pDate.getDate() + 1);
      }
      const formattedDate = `/Date(${pDate.getTime()})/`;

      const safeName = (data.customerName || 'BOOK MY STUDY-C/P').trim().substring(0, 30);
      const address1 = (data.address1 || 'Office No.101').trim().substring(0, 30);
      const address2 = (data.address2 || 'First Floor').trim().substring(0, 30);
      const address3 = (data.address3 || 'Surat').trim().substring(0, 30);
      let safeEmail = (data.email || '').trim();
      if (!safeEmail.includes('@')) safeEmail = 'support@kiddosintellect.com';

      const loginID = data.creds?.loginID || 'SUR96891';
      const actualShipperCode = data.customerCode || loginID;

      const length = Number(data.length) || 20;
      const breadth = Number(data.breadth) || 15;
      const height = Number(data.height) || 5;
      const weight = Number(data.weight) || 0.5;

      const volumetricWeight = (length * breadth * height) / 5000;
      const chargeableWeight = Math.max(weight, volumetricWeight);

      const payload = {
        Request: {
          Shipper: {
            OriginArea: data.creds?.areaCode || 'SUR',
            CustomerCode: actualShipperCode,
            CustomerName: safeName,
            ContactPersonName: safeName,
            CustomerAddress1: address1,
            CustomerAddress2: address2,
            CustomerAddress3: address3,
            CustomerPincode: String(data.pincode || '395009'),
            CustomerMobile: String(data.mobile || ''),
            CustomerTelephone: String(data.phone || ''),
            CustomerEmailID: safeEmail,
            IsToPayCustomer: false
          },
          Pickup: {
            PickupDate: formattedDate,
            PickupTime: this.formatTime(data.pickupTime || '1400'),
            PickupMode: 'P',
            ProductCode: data.productCode || 'A',
            ProductType: 2,
            SubProductCode: 'P',
            ReferenceNo: `PICK${Date.now().toString().slice(-8)}`,
            PackType: 'NON-DOCS',
            NumberOfPieces: Number(data.numberOfPieces) || 1,
            ActualWeight: weight,
            VolumeWeight: chargeableWeight,
            Dimensions: [{
              Length: length,
              Breadth: breadth,
              Height: height,
              Count: Number(data.numberOfPieces) || 1
            }],
            Remarks: data.remarks || 'API Pickup Request'
          }
        },
        Profile: {
          Api_type: 'S',
          Area: data.creds?.areaCode || 'SUR',
          Customercode: loginID,
          LicenceKey: data.creds?.licenseKey,
          LoginID: loginID,
          Version: '1.8',
          IsAdmin: ''
        }
      };

      console.log("📤 [PICKUP REQUEST] Payload:", JSON.stringify(payload, null, 2));

      const result = await this.apiCall('POST', '/in/transportation/pickup/v1/RegisterPickup', payload);

      console.log("📥 [PICKUP RESPONSE] Raw Output:", JSON.stringify(result, null, 2));

      const output = result.PickupRegistrationOutput || result;
      const isError = output.IsError === 'true' || output.IsError === true;

      if (!isError && (output.ConfirmationNumber || output.TokenNumber)) {
        return {
          success: true,
          confirmationNumber: output.ConfirmationNumber || '',
          tokenNumber: output.TokenNumber || '',
          pickupDate: output.PickupDate || formattedDate,
          status: output.Status || 'Success'
        };
      }

      let errorMsg = 'Pickup registration failed';
      if (output.Status && Array.isArray(output.Status)) {
        errorMsg = output.Status[0]?.StatusInformation || errorMsg;
      } else if (output.ErrorMessage) {
        errorMsg = output.ErrorMessage;
      } else if (result['error-response']?.[0]?.msg) {
        errorMsg = result['error-response'][0].msg;
      }
      return { success: false, error: errorMsg };

    } catch (error) {
      console.error('❌ Pickup Exception:', error.message);
      return { success: false, error: error.message };
    }
  }

  // ✅ 5. CHECK SERVICEABILITY
  async checkServiceability(pincode) {
    try {
      const result = await this.apiCall('GET', `/in/transportation/locationfinder/v1?Pincode=${pincode}`);
      if (result.GetServicesforPinCodeResult?.IsError === 'false') {
        const data = result.GetServicesforPinCodeResult;
        return {
          success: true,
          serviceable: true,
          area: data.Area || '',
          services: {
            express: data.ExpressAvailable === 'Y',
            surface: data.SurfaceAvailable === 'Y',
            cod: data.CODAvailable === 'Y',
            pickup: data.PickupAvailable === 'Y'
          }
        };
      }
      return { success: false, serviceable: false, error: 'Pincode not serviceable' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async cancelPickup(confirmationNumber, reason = 'User Requested') {
    return { success: true, message: 'Pickup cancelled (mock)' };
  }

  async cancelWaybill(awbNumber, reason = 'User Requested') {
    try {
      console.log('❌ [API] Cancelling waybill:', awbNumber);
      const payload = {
        Request: { AWBNo: awbNumber },
        Profile: {
          Api_type: 'S',
          Area: 'SUR',
          Customercode: 'SUR96891',
          LicenceKey: process.env.BLUEDART_LICENSE_KEY || 'kogqnihoth6pi4hfkgihrsujpttff7wr',
          LoginID: 'SUR96891',
          Version: '1.3',
          IsAdmin: ''
        }
      };

      const result = await this.apiCall('POST', '/in/transportation/waybill/v1/CancelWayBill', payload);

      if (result.IsError === false || result.IsError === 'false') {
        return { success: true, message: 'Waybill cancelled successfully' };
      }

      throw new Error('Cancellation failed');
    } catch (error) {
      console.error('❌ Cancel waybill error:', error.message);
      return { success: false, error: error.message };
    }
  }
}

export default new BlueDartAPI();