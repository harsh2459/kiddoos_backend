import axios from 'axios';

const BASE_URL = process.env.BLUEDART_BASE_URL || 'https://netconnect.bluedart.com';
const SHIPPING_KEY = process.env.BLUEDART_SHIPPING_KEY;
const TRACKING_KEY = process.env.BLUEDART_TRACKING_KEY;
const CLIENT_NAME = process.env.BLUEDART_CLIENT_NAME;

function authHeaders(apiKey) {
  return {
    'Content-Type': 'application/json',
    'Authorization': apiKey,
    'x-client-name': CLIENT_NAME
  };
}

// Create shipment/waybill
export async function createWaybill(payload) {
  const url = `${BASE_URL}/api/v1/waybill`;
  const resp = await axios.post(url, payload, { headers: authHeaders(SHIPPING_KEY), timeout: 30000 });
  return resp.data;
}

// Track shipment
export async function trackShipment(awbNumber) {
  const url = `${BASE_URL}/api/v1/tracking`;
  const resp = await axios.post(url, { awbNumber }, { headers: authHeaders(TRACKING_KEY), timeout: 30000 });
  return resp.data;
}

// Schedule pickup
export async function schedulePickup(pickupData) {
  const url = `${BASE_URL}/api/v1/pickup`;
  const resp = await axios.post(url, pickupData, { headers: authHeaders(SHIPPING_KEY), timeout: 30000 });
  return resp.data;
}

// Cancel shipment
export async function cancelShipment(awbNumber) {
  const url = `${BASE_URL}/api/v1/cancel`;
  const resp = await axios.post(url, { awbNumber }, { headers: authHeaders(SHIPPING_KEY), timeout: 30000 });
  return resp.data;
}
