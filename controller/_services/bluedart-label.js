// backend/_services/bluedart-label.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class BlueDartLabel {
  constructor() {
    // Save to: project_root/uploads/labels
    this.labelsDir = path.join(__dirname, '../../uploads/labels');
    this.ensureLabelsDir();
  }

  ensureLabelsDir() {
    if (!fs.existsSync(this.labelsDir)) {
      fs.mkdirSync(this.labelsDir, { recursive: true });
      console.log('✅ Labels directory created:', this.labelsDir);
    }
  }

  /**
   * ✅ NEW METHOD: Save label from the bytes/buffer received during Waybill Generation
   */
  async saveLabelFromContent(awbNumber, content) {
    try {
      if (!content || !awbNumber) throw new Error('Missing content or AWB');

      const fileName = `label-${awbNumber}.pdf`;
      const filePath = path.join(this.labelsDir, fileName);

      // Handle different content types (Array, Buffer, or Base64 string)
      let buffer;
      if (Buffer.isBuffer(content)) {
        buffer = content;
      } else if (Array.isArray(content)) {
        buffer = Buffer.from(content);
      } else if (typeof content === 'string') {
        // Assume Base64 if string
        buffer = Buffer.from(content, 'base64');
      } else {
        throw new Error('Unknown label content format');
      }

      fs.writeFileSync(filePath, buffer);
      console.log('✅ [Label] Saved locally:', fileName);

      return {
        success: true,
        fileName: fileName,
        url: `/uploads/labels/${fileName}`, // URL accessible by frontend
        filePath: filePath
      };
    } catch (error) {
      console.error('❌ [Label] Save Error:', error.message);
      return { success: false, error: error.message };
    }
  }

  // ✅ Check if label exists locally
  async getLabel(fileName) {
    const filePath = path.join(this.labelsDir, fileName);
    if (fs.existsSync(filePath)) {
      return {
        success: true,
        url: `/uploads/labels/${fileName}`,
        fileName: fileName
      };
    }
    return { success: false, error: 'Label not found' };
  }
}

export default new BlueDartLabel();