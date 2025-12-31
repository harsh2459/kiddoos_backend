// backend/_services/bluedart-label.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument } from 'pdf-lib'; // Import pdf-lib

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class BlueDartLabel {
  constructor() {
    this.labelsDir = path.join(__dirname, '../../uploads/labels');
    this.ensureLabelsDir();
  }

  ensureLabelsDir() {
    if (!fs.existsSync(this.labelsDir)) {
      fs.mkdirSync(this.labelsDir, { recursive: true });
    }
  }

  /**
   * ✅ CROP FUNCTION: Cuts the label out of the A4 page
   */
  async cropToThermal(pdfBuffer) {
    try {
      const pdfDoc = await PDFDocument.load(pdfBuffer);
      const pages = pdfDoc.getPages();
      const firstPage = pages[0];
      const { height } = firstPage.getSize();

      // Crop the Top-Left corner (Standard Blue Dart placement)
      // Adjust these numbers if the cut is slightly off
      firstPage.setCropBox(20, height - 440, 400, 420); 

      // Create new 4x6 document
      const newPdf = await PDFDocument.create();
      const [embeddedPage] = await newPdf.embedPdf(pdfDoc, [0]);
      
      // Add page (Landscape 6x4 or Portrait 4x6)
      const thermalPage = newPdf.addPage([432, 288]); 
      
      thermalPage.drawPage(embeddedPage, {
        x: 10,
        y: 0,
        width: 410,
        height: 288,
      });

      const newPdfBytes = await newPdf.save();
      return Buffer.from(newPdfBytes);

    } catch (error) {
      console.error("⚠️ Cropping failed, using original A4:", error.message);
      return pdfBuffer;
    }
  }

  async saveLabelFromContent(awbNumber, content) {
    try {
      if (!content || !awbNumber) throw new Error('Missing content or AWB');
      
      let buffer;
      if (Buffer.isBuffer(content)) buffer = content;
      else if (typeof content === 'string') buffer = Buffer.from(content, 'base64');
      else buffer = Buffer.from(content);

      // ➤ APPLY CROP
      console.log('✂️  Cropping Label...');
      buffer = await this.cropToThermal(buffer);

      const fileName = `label-${awbNumber}.pdf`;
      const filePath = path.join(this.labelsDir, fileName);

      fs.writeFileSync(filePath, buffer);

      return {
        success: true,
        fileName: fileName,
        filePath: filePath,
        buffer: buffer // Return the cropped buffer for upload
      };
    } catch (error) {
      console.error('❌ [Label] Save Error:', error.message);
      return { success: false, error: error.message };
    }
  }
  
  async getLabel(fileName) {
    const filePath = path.join(this.labelsDir, fileName);
    if (fs.existsSync(filePath)) return { success: true, content: fs.readFileSync(filePath) };
    return { success: false, error: 'File not found' };
  }
}

export default new BlueDartLabel();