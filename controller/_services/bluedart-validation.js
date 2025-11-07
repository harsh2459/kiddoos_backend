import { BD_CONFIG } from './bluedart-config.js';

export class BlueDartValidator {
  /**
   * Validate waybill/shipment data
   */
  static validateWaybillData(data) {
    const errors = [];

    // Shipper validation
    if (!data.consigner) {
      errors.push('Shipper/Consigner details missing');
      return { isValid: false, errors };
    }

    // Shipper pincode (6 digits)
    if (!this.isValidPincode(data.consigner.pincode)) {
      errors.push('Shipper pincode must be exactly 6 digits');
    }

    // Shipper name (max 30 chars, no < >)
    if (!this.isValidName(data.consigner.name)) {
      errors.push('Shipper name: max 30 characters, remove < > characters');
    }

    // Shipper address (max 30 chars each, no < >)
    if (data.consigner.address && !this.isValidAddress(data.consigner.address)) {
      errors.push('Shipper address1: max 30 characters, remove < > characters');
    }

    // Shipper mobile (10-15 digits)
    if (data.consigner.mobile && !this.isValidMobile(data.consigner.mobile)) {
      errors.push('Shipper mobile must be 10-15 digits');
    }

    // Shipper email
    if (data.consigner.email && !this.isValidEmail(data.consigner.email)) {
      errors.push('Shipper email is invalid format');
    }

    // ========== CONSIGNEE VALIDATION ==========
    if (!data.consignee) {
      errors.push('Consignee/Recipient details missing');
      return { isValid: false, errors };
    }

    // Consignee pincode (6 digits)
    if (!this.isValidPincode(data.consignee.pincode)) {
      errors.push('Consignee pincode must be exactly 6 digits');
    }

    // Consignee name
    if (!this.isValidName(data.consignee.name)) {
      errors.push('Consignee name: max 30 characters, remove < > characters');
    }

    // Consignee address
    if (data.consignee.address && !this.isValidAddress(data.consignee.address)) {
      errors.push('Consignee address1: max 30 characters, remove < > characters');
    }

    // Consignee mobile
    if (data.consignee.mobile && !this.isValidMobile(data.consignee.mobile)) {
      errors.push('Consignee mobile must be 10-15 digits');
    }

    // ========== SERVICES VALIDATION ==========
    if (!data.services) {
      errors.push('Services/Shipping details missing');
      return { isValid: false, errors };
    }

    // Product code
    if (!data.services.productCode || !['A', 'D', 'I'].includes(data.services.productCode)) {
      errors.push('Product code must be A (Prepaid), D (COD), or I (International)');
    }

    // Weight
    if (!data.services.weight || data.services.weight <= 0) {
      errors.push('Weight must be > 0');
    }

    // Declared value
    if (!data.services.declaredValue || data.services.declaredValue <= 0) {
      errors.push('Declared value must be > 0');
    }

    // COD validation
    if (data.services.productCode === 'D') {
      if (!data.services.codAmount || data.services.codAmount <= 0) {
        errors.push('COD amount must be > 0 for COD shipments');
      }
      if (data.services.codAmount > data.services.declaredValue) {
        errors.push('COD amount cannot exceed declared value');
      }
    }

    // Pickup date (cannot be in past)
    if (!this.isValidFutureDate(data.services.pickupDate)) {
      errors.push('Pickup date must be today or in future');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // ========== HELPER VALIDATORS ==========

  static isValidPincode(pincode) {
    return /^\d{6}$/.test(String(pincode).trim());
  }

  static isValidMobile(mobile) {
    return /^\d{10,15}$/.test(String(mobile).trim());
  }

  static isValidName(name) {
    if (!name) return false;
    const str = String(name).trim();
    return str.length <= 30 && !/<|>/.test(str);
  }

  static isValidAddress(address) {
    if (!address) return true; // Optional field
    const str = String(address).trim();
    return str.length <= 30 && !/<|>/.test(str);
  }

  static isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
  }

  static isValidFutureDate(date) {
    const pickupDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return pickupDate >= today;
  }

  /**
   * Format data for Blue Dart API
   */
  static formatForAPI(data) {
    return {
      consigner: {
        name: this.sanitize(data.consigner.name, 30),
        address: this.sanitize(data.consigner.address, 30),
        address2: this.sanitize(data.consigner.address2, 30),
        address3: this.sanitize(data.consigner.address3, 30),
        pincode: String(data.consigner.pincode).trim(),
        phone: String(data.consigner.phone || '').trim(),
        mobile: String(data.consigner.mobile || '').trim(),
        email: String(data.consigner.email || '').trim()
      },
      consignee: {
        name: this.sanitize(data.consignee.name, 30),
        address: this.sanitize(data.consignee.address, 30),
        address2: this.sanitize(data.consignee.address2, 30),
        address3: this.sanitize(data.consignee.address3, 30),
        pincode: String(data.consignee.pincode).trim(),
        phone: String(data.consignee.phone || '').trim(),
        mobile: String(data.consignee.mobile || '').trim(),
        email: String(data.consignee.email || '').trim()
      },
      services: {
        productCode: String(data.services.productCode).toUpperCase(),
        weight: parseFloat(data.services.weight),
        declaredValue: parseFloat(data.services.declaredValue),
        codAmount: parseFloat(data.services.codAmount || 0),
        pickupDate: data.services.pickupDate
      }
    };
  }

  static sanitize(str, maxLength = 30) {
    if (!str) return '';
    return String(str)
      .trim()
      .substring(0, maxLength)
      .replace(/[<>]/g, '');
  }
}

export default BlueDartValidator;
