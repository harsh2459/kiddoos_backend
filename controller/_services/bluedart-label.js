// backend/_services/bluedart-label.js

import axios from 'axios';
import BlueDartAuth from './bluedart-auth.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class BlueDartLabel {
  constructor() {
    this.baseUrl = process.env.BLUEDART_BASE_URL;
    this.labelsDir = path.join(__dirname, '../../uploads/labels');
    this.ensureLabelsDir();
  }

  // Ensure labels directory exists
  ensureLabelsDir() {
    if (!fs.existsSync(this.labelsDir)) {
      fs.mkdirSync(this.labelsDir, { recursive: true });
      console.log('✅ Labels directory created:', this.labelsDir);
    }
  }

  // Get label PDF from Blue Dart API
  async getLabelFromBlueDart(awbNumber) {
    try {
      if (!awbNumber) {
        throw new Error('AWB number is required');
      }

      console.log('🏷️ [Label] Requesting label from Blue Dart for AWB:', awbNumber);

      // Get JWT token
      const headers = await BlueDartAuth.getAuthHeaders();

      // Call Blue Dart Print Label API
      const response = await axios({
        method: 'GET',
        url: `${this.baseUrl}/in/transportation/waybills/v1/printlabel?AirwayBillNumber=${awbNumber}`,
        headers: {
          ...headers,
          'Accept': 'application/pdf'
        },
        responseType: 'arraybuffer',
        timeout: 30000,
        validateStatus: () => true
      });

      // Check response status
      if (response.status === 200 && response.data && response.data.length > 0) {
        // Save PDF to server
        const fileName = `label-${awbNumber}-${Date.now()}.pdf`;
        const filePath = path.join(this.labelsDir, fileName);

        // Write file synchronously
        fs.writeFileSync(filePath, response.data);

        console.log('✅ [Label] Saved to server:', fileName);

        return {
          success: true,
          fileName: fileName,
          filePath: filePath,
          url: `/uploads/labels/${fileName}`,
          awbNumber: awbNumber,
          savedAt: new Date()
        };
      }

      // Handle error response
      const errorMsg = response.data ? response.data.toString() : 'Failed to get label from Blue Dart';
      console.error('❌ [Label] Error response:', response.status, errorMsg);

      return {
        success: false,
        error: 'Failed to generate label from Blue Dart. Please try again.',
        status: response.status
      };
    } catch (error) {
      console.error('❌ [Label] Error:', error.message);

      return {
        success: false,
        error: error.message || 'Error generating label'
      };
    }
  }

  // Get saved label file
  async getLabel(fileName) {
    try {
      if (!fileName) {
        return { success: false, error: 'File name required' };
      }

      const filePath = path.join(this.labelsDir, fileName);

      // Validate file exists and is in correct directory
      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'Label file not found' };
      }

      return {
        success: true,
        filePath: filePath,
        fileName: fileName
      };
    } catch (error) {
      console.error('❌ [Label] Get error:', error.message);
      return { success: false, error: error.message };
    }
  }

  // Delete label file
  async deleteLabel(fileName) {
    try {
      if (!fileName) {
        return { success: false, error: 'File name required' };
      }

      const filePath = path.join(this.labelsDir, fileName);

      // Validate file is in correct directory
      if (!filePath.startsWith(this.labelsDir)) {
        return { success: false, error: 'Invalid file path' };
      }

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log('✅ [Label] Deleted:', fileName);
        return { success: true, message: 'Label deleted successfully' };
      }

      return { success: false, error: 'Label file not found' };
    } catch (error) {
      console.error('❌ [Label] Delete error:', error.message);
      return { success: false, error: error.message };
    }
  }

  // Clean old labels (keep last 30 days)
  async cleanOldLabels(daysToKeep = 30) {
    try {
      const now = Date.now();
      const maxAge = daysToKeep * 24 * 60 * 60 * 1000;

      const files = fs.readdirSync(this.labelsDir);

      files.forEach(file => {
        const filePath = path.join(this.labelsDir, file);
        const stat = fs.statSync(filePath);
        const age = now - stat.mtimeMs;

        if (age > maxAge) {
          fs.unlinkSync(filePath);
          console.log('🗑️ [Label] Cleaned old file:', file);
        }
      });

      console.log('✅ [Label] Cleanup completed');
    } catch (error) {
      console.error('❌ [Label] Cleanup error:', error.message);
    }
  }
}

export default new BlueDartLabel();
