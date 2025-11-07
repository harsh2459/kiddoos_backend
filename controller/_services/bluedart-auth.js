// backend/_services/bluedart-auth.js

import axios from 'axios';
import { BD_CONFIG } from './bluedart-config.js';

class BlueDartAuth {
  constructor() {
    this.token = null;
    this.tokenExpiry = null;
  }

  async generateToken(forceRefresh = false) {
    try {
      if (!forceRefresh && this.isTokenValid()) {
        console.log('✅ [Auth] Using cached JWT token');
        return this.token;
      }

      const clientId = process.env.BLUEDART_CLIENT_ID;
      const clientSecret = process.env.BLUEDART_CLIENT_SECRET;
      const baseUrl = process.env.BLUEDART_BASE_URL;

      if (!clientId || !clientSecret) {
        throw new Error('Missing Blue Dart credentials');
      }

      console.log('🔄 [Auth] Generating new JWT token...');

      const response = await axios.get(
        `${baseUrl}${BD_CONFIG.endpoints.token}`,
        {
          headers: {
            'ClientID': clientId,
            'clientSecret': clientSecret,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      if (!response.data?.JWTToken) {
        throw new Error('No JWT token in response');
      }

      this.token = response.data.JWTToken;
      this.tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

      console.log('✅ [Auth] Token generated successfully');
      return this.token;

    } catch (error) {
      console.error('❌ [Auth] Failed:', error.message);
      throw error;
    }
  }

  isTokenValid() {
    if (!this.token || !this.tokenExpiry) return false;
    const bufferTime = 5 * 60 * 1000;
    return Date.now() < (this.tokenExpiry.getTime() - bufferTime);
  }

  async refreshToken() {
    this.token = null;
    this.tokenExpiry = null;
    return await this.generateToken(true);
  }

  async getAuthHeaders() {
    const token = await this.generateToken();
    return {
      'Content-Type': 'application/json',
      'JWTToken': token
    };
  }
}

export default new BlueDartAuth();
