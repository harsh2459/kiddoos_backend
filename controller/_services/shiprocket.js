// _services/shiprocket.js
import axios from "axios";
import User from "../../model/User.js";
import { decrypt } from "./crypto.js";

const BASE = process.env.SR_BASE || "https://apiv2.shiprocket.in";
const TOKEN_REFRESH_BUFFER = 15 * 60 * 1000; // Refresh token 15 minutes before expiry

// Get active profile with proper error handling
async function getActiveProfile(userId) {
  try {
    const user = await User.findById(userId)
      .select("integrations.shiprocket.profiles")
      .lean();

    if (!user) throw new Error("User not found");

    const profiles = user.integrations?.shiprocket?.profiles || [];
    const activeProfile = profiles.find(p => p.active);

    if (!activeProfile) {
      throw new Error("No active Shiprocket profile configured");
    }

    return activeProfile;
  } catch (error) {
    console.error("Error getting active profile:", error);
    throw error;
  }
}

// Update profile auth token
async function updateProfileAuth(userId, profileId, token) {
  try {
    // Token expires in 10 days (240 hours) as per Shiprocket
    const expiresAt = new Date(Date.now() + 240 * 3600 * 1000);

    await User.updateOne(
      { _id: userId, "integrations.shiprocket.profiles._id": profileId },
      {
        $set: {
          "integrations.shiprocket.profiles.$.auth.token": token,
          "integrations.shiprocket.profiles.$.auth.expiresAt": expiresAt
        }
      }
    );
  } catch (error) {
    console.error("Error updating profile auth:", error);
    throw error;
  }
}

// Login to Shiprocket
export async function srLogin(credentials) {
  try {
    const { email, password } = credentials;

    if (!email || !password) {
      throw new Error("Email and password required for Shiprocket login");
    }

    const response = await axios.post(
      `${BASE}/v1/external/auth/login`,
      { email, password },
      { timeout: 10000 }
    );

    if (!response.data.token) {
      throw new Error("No token received from Shiprocket");
    }

    return response.data.token;
  } catch (error) {
    console.error("Shiprocket login error:", error.response?.data || error.message);

    if (error.response?.status === 401) {
      throw new Error("Invalid Shiprocket credentials");
    } else if (error.code === 'ECONNABORTED') {
      throw new Error("Shiprocket API timeout");
    } else {
      throw new Error(`Shiprocket login failed: ${error.message}`);
    }
  }
}

// Main SR API caller with automatic token refresh
export async function sr(method, path, { params, data, headers } = {}, { userId } = {}) {
  try {
    // Mock mode for dev/testing (no network)
    if (process.env.SR_MOCK === "1") {
      return { data: { ok: true, mock: true, method, path, params, data } };
    }
    // Fallback: use the first admin that has an active profile
    if (!userId) {
      const owner = await User.findOne({
        role: "admin",
        "integrations.shiprocket.profiles.active": true
      }).select("_id").lean();
      if (!owner?._id) throw new Error("No active Shiprocket profile configured");
      userId = owner._id;
    }

    const profile = await getActiveProfile(userId);
    let token = profile.auth?.token;
    let needsRefresh = false;

    // Check if token needs refresh
    if (!token) {
      needsRefresh = true;
    } else {
      const expiresAt = new Date(profile.auth.expiresAt);
      const now = new Date();
      // Refresh if token expires within 15 minutes
      if (expiresAt - now < TOKEN_REFRESH_BUFFER) {
        needsRefresh = true;
      }
    }

    // Refresh token if needed
    if (needsRefresh) {
      console.log("Refreshing Shiprocket token...");
      const decryptedPassword = decrypt(profile.passwordEnc);
      token = await srLogin({
        email: profile.email,
        password: decryptedPassword
      });

      await updateProfileAuth(userId, profile._id, token);
    }

    // Make the API call
    const response = await axios({
      method,
      url: `${BASE}/v1/external${path}`,
      params,
      data,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...headers
      },
      timeout: 30000
    });

    return response;
  } catch (error) {
    // Handle token expiration specifically
    if (error.response?.status === 401) {
      console.log("Token invalid, attempting to refresh...");

      try {
        // Refresh token and retry
        const profile = await getActiveProfile(userId);
        const decryptedPassword = decrypt(profile.passwordEnc);
        const freshToken = await srLogin({
          email: profile.email,
          password: decryptedPassword
        });

        await updateProfileAuth(userId, profile._id, freshToken);

        // Retry the original request with new token
        const retryResponse = await axios({
          method,
          url: `${BASE}/v1/external${path}`,
          params,
          data,
          headers: {
            Authorization: `Bearer ${freshToken}`,
            'Content-Type': 'application/json',
            ...headers
          },
          timeout: 30000
        });

        return retryResponse;
      } catch (retryError) {
        console.error("Retry failed after token refresh:", retryError);
        throw new Error(`Shiprocket API request failed even after token refresh: ${retryError.message}`);
      }
    }

    console.error("Shiprocket API error:", error.response?.data || error.message);
    throw error;
  }
}