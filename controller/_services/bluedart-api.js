// backend/_services/bluedart-api.js

import axios from 'axios';
import BlueDartAuth from './bluedart-auth.js';
import BlueDartValidator from './bluedart-validation.js';
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

  // ✅ 1. CREATE WAYBILL (EXISTING - KEEP AS IS)
  async createWaybill(data) {
    try {
      console.log('📦 [API] Creating waybill...');

      const payload = {
        Request: {
          Consigner: {
            ConsignerName: data.consigner.name,
            ConsignerAddress1: data.consigner.address,
            ConsignerAddress2: data.consigner.address2 || '',
            ConsignerAddress3: data.consigner.address3 || '',
            ConsignerPinCode: data.consigner.pincode,
            ConsignerPhoneNumber: data.consigner.phone || '',
            ConsignerMobileNumber: data.consigner.mobile,
            ConsignerEmailAddress: data.consigner.email
          },
          Consignee: {
            ConsigneeName: data.consignee.name,
            ConsigneeAddress1: data.consignee.address,
            ConsigneeAddress2: data.consignee.address2 || '',
            ConsigneeAddress3: data.consignee.address3 || '',
            ConsigneePinCode: data.consignee.pincode,
            ConsigneePhoneNumber: data.consignee.phone || '',
            ConsigneeMobileNumber: data.consignee.mobile,
            ConsigneeEmailAddress: data.consignee.email
          },
          Services: {
            ProductCode: data.productCode || 'D',
            Weight: data.weight || 0.5,
            DeclaredValue: data.declaredValue || 0,
            CODAmount: data.codAmount || 0
          }
        }
      };

      const result = await this.apiCall('POST', '/in/transportation/waybills/v1', payload);

      if (result.WaybillOutput?.IsError === 'false') {
        return {
          success: true,
          awbNumber: result.WaybillOutput.AirwayBillNumber,
          tokenNumber: result.WaybillOutput.TokenNumber,
          codAmount: result.WaybillOutput.CODAmount || 0
        };
      }

      throw new Error('Waybill creation failed');
    } catch (error) {
      console.error('❌ Waybill error:', error.message);
      throw error;
    }
  }

  // ✅ 2. TRACK SHIPMENT (EXISTING - KEEP AS IS)
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

  // 🆕 3. TRANSIT TIME FINDER
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

  // 🆕 4. SCHEDULE PICKUP
  async schedulePickup(data) {
    try {
      console.log('📦 [API] Scheduling pickup...');

      const payload = {
        Request: {
          Shipper: {
            CustomerCode: data.customerCode,
            CustomerName: data.customerName,
            CustomerAddress1: data.address1,
            CustomerAddress2: data.address2 || '',
            CustomerAddress3: data.address3 || '',
            CustomerPincode: data.pincode,
            CustomerTelephone: data.phone || '',
            CustomerMobile: data.mobile,
            CustomerEmailID: data.email
          },
          Pickup: {
            PickupDate: this.formatDate(data.pickupDate),
            PickupTime: this.formatTime(data.pickupTime || '1400'),
            PickupMode: data.mode || 'SURFACE',
            ProductType: data.productType || 'A',
            PackType: data.packType || 'NON-DOCS',
            NumberOfPieces: data.numberOfPieces || 1,
            ActualWeight: data.weight || 0.5,
            PickupRequestBy: data.requestedBy || 'SYSTEM'
          }
        }
      };

      const result = await this.apiCall('POST', '/in/transportation/pickup/v1/RegisterPickup', payload);

      if (result.PickupRegistrationOutput?.IsError === 'false') {
        return {
          success: true,
          confirmationNumber: result.PickupRegistrationOutput.ConfirmationNumber,
          tokenNumber: result.PickupRegistrationOutput.TokenNumber,
          pickupDate: result.PickupRegistrationOutput.PickupDate,
          status: result.PickupRegistrationOutput.Status || 'Success'
        };
      }

      throw new Error(result.PickupRegistrationOutput?.Status || 'Pickup registration failed');
    } catch (error) {
      console.error('❌ Pickup error:', error.message);
      throw error;
    }
  }

  // 🆕 5. CHECK SERVICEABILITY (PINCODE)
  async checkServiceability(pincode) {
    try {
      console.log('📍 [API] Checking pincode:', pincode);

      const result = await this.apiCall('GET', `/in/transportation/locationfinder/v1?Pincode=${pincode}`);

      if (result.GetServicesforPinCodeResult?.IsError === 'false') {
        const data = result.GetServicesforPinCodeResult;
        return {
          success: true,
          serviceable: true,
          area: data.Area || '',
          city: data.City || '',
          state: data.State || '',
          country: data.Country || 'India',
          services: {
            express: data.ExpressAvailable === 'Y',
            surface: data.SurfaceAvailable === 'Y',
            cod: data.CODAvailable === 'Y',
            pickup: data.PickupAvailable === 'Y'
          }
        };
      }

      return {
        success: false,
        serviceable: false,
        error: result.GetServicesforPinCodeResult?.Status || 'Pincode not serviceable'
      };
    } catch (error) {
      console.error('❌ Serviceability error:', error.message);
      return { success: false, serviceable: false, error: error.message };
    }
  }

  // 🆕 6. CANCEL PICKUP (BONUS)
  async cancelPickup(confirmationNumber, reason = 'User Requested') {
    try {
      console.log('❌ [API] Cancelling pickup:', confirmationNumber);

      const payload = {
        Request: {
          ConfirmationNumber: confirmationNumber,
          CancellationReason: reason
        }
      };

      const result = await this.apiCall('POST', '/in/transportation/pickup/v1/CancelPickup', payload);

      if (result.PickupCancellationOutput?.IsError === 'false') {
        return {
          success: true,
          status: result.PickupCancellationOutput.Status || 'Cancelled',
          message: 'Pickup cancelled successfully'
        };
      }

      throw new Error(result.PickupCancellationOutput?.Status || 'Pickup cancellation failed');
    } catch (error) {
      console.error('❌ Cancel pickup error:', error.message);
      throw error;
    }
  }

  // 🆕 7. CANCEL WAYBILL/SHIPMENT (BONUS)
  async cancelWaybill(awbNumber, reason = 'User Requested') {
    try {
      console.log('❌ [API] Cancelling waybill:', awbNumber);

      const payload = {
        Request: {
          AWBNumber: awbNumber,
          CancellationReason: reason
        }
      };

      const result = await this.apiCall('POST', '/in/transportation/waybill/v1/CancelWayBill', payload);

      if (result.CancelWayBillOutput?.IsError === 'false') {
        return {
          success: true,
          status: result.CancelWayBillOutput.Status || 'Cancelled',
          message: 'Waybill cancelled successfully'
        };
      }

      throw new Error(result.CancelWayBillOutput?.Status || 'Waybill cancellation failed');
    } catch (error) {
      console.error('❌ Cancel waybill error:', error.message);
      throw error;
    }
  }
}

export default new BlueDartAPI();
