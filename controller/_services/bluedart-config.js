// backend/_services/bluedart-config.js

export const BD_CONFIG = {
  endpoints: {
    token: '/in/transportation/token/v1/login',
    waybill: '/in/transportation/waybill/v1/GenerateWayBill',
    tracking: '/servlet/RoutingServlet',
    pickup: '/in/transportation/pickup/v1/RegisterPickup',
    cancelPickup: '/in/transportation/pickup/v1/CancelPickup',
    transitTime: '/in/transportation/transittime/v1',
    locationFinder: '/in/transportation/locationfinder/v1'
  },

  errorCodes: {
    'UserDoesNotExists': {
      message: 'Invalid API credentials',
      httpStatus: 401,
      solution: 'Check BLUEDART_CLIENT_ID and BLUEDART_CLIENT_SECRET in .env'
    },
    'InvalidPinCode': {
      message: 'Pincode must be 6 digits',
      httpStatus: 400,
      solution: 'Provide a valid 6-digit pincode'
    },
    'InvalidProductCode': {
      message: 'Invalid product code',
      httpStatus: 400,
      solution: 'Use A or D for product code'
    },
    'InvalidSubProduct': {
      message: 'Invalid sub-product code',
      httpStatus: 400,
      solution: 'Use P (Prepaid) or C (COD)'
    },
    'UnAuthorizedUser': {
      message: 'Customer code not authorized',
      httpStatus: 403,
      solution: 'Check if customer code exists in Blue Dart'
    },
    'InvalidClientName': {
      message: 'Customer name invalid (max 30 chars, no < >)',
      httpStatus: 400,
      solution: 'Sanitize name - remove < > and limit to 30 chars'
    },
    'InvalidAddress1': {
      message: 'Address invalid (max 30 chars, no special chars)',
      httpStatus: 400,
      solution: 'Sanitize address - remove < >'
    },
    'AwbGenerationFailure': {
      message: 'Waybill generation failed',
      httpStatus: 400,
      solution: 'Check declared value > 0'
    },
    'InvalidPickupDate': {
      message: 'Pickup date cannot be in past',
      httpStatus: 400,
      solution: 'Use current or future date'
    },
    'InvalidCollectableAmount': {
      message: 'COD amount must be > 0 and <= declared value',
      httpStatus: 400,
      solution: 'Adjust COD amount'
    },
    'OutBoundServiceNotAvailable': {
      message: 'Service not available for this pincode',
      httpStatus: 400,
      solution: 'Check pincode with Location Finder API'
    },
    'Communication failure': {
      message: 'Blue Dart service unavailable',
      httpStatus: 503,
      solution: 'Check if Blue Dart APIs are running'
    }
  }
};

export function getErrorMessage(errorCode, defaultMessage) {
  const error = BD_CONFIG.errorCodes[errorCode];
  if (error) {
    return `${error.message} - ${error.solution}`;
  }
  return defaultMessage || 'An error occurred with Blue Dart API';
}

export default BD_CONFIG;
