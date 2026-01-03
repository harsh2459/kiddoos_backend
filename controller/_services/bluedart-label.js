// backend/_services/bluedart-label.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import bwipjs from 'bwip-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class BlueDartLabel {
  constructor() {
    this.labelsDir = path.join(__dirname, '../../uploads/labels');
    // logoPath kept for reference even if commented out
    this.logoPath = path.join(__dirname, '../../assets/Final_logo_jpg.jpg'); 
    this.ensureLabelsDir();
  }

  ensureLabelsDir() {
    if (!fs.existsSync(this.labelsDir)) {
      fs.mkdirSync(this.labelsDir, { recursive: true });
    }
  }

  async generateCustomLabel(data) {
    try {
      const pdfDoc = await PDFDocument.create();
      // 4x6 inches = 288 x 432 points
      const page = pdfDoc.addPage([288, 432]); 
      const { width, height } = page.getSize();

      const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const fontReg = await pdfDoc.embedFont(StandardFonts.Helvetica);

      // --- Helpers ---
      const drawText = (text, x, y, size = 10, font = fontReg, opts = {}) => {
        page.drawText(String(text || '').toUpperCase(), { x, y, size, font, color: rgb(0,0,0), ...opts });
      };
      
      const drawLine = (y, thickness = 1) => {
        page.drawLine({ start: { x: 10, y }, end: { x: width - 10, y }, thickness, color: rgb(0,0,0) });
      };

      // ==========================================
      // 1. HEADER ZONE (Top)
      // ==========================================
      const headerTop = height - 20; // Y = 412
      
      /* // --- LOGO LOGIC (Commented out per request) ---
      let logoDrawn = false;
      if (fs.existsSync(this.logoPath)) {
        try {
          const logoBytes = fs.readFileSync(this.logoPath);
          let logoImage = this.logoPath.toLowerCase().endsWith('.png') 
            ? await pdfDoc.embedPng(logoBytes) 
            : await pdfDoc.embedJpg(logoBytes);

          if (logoImage) {
            const logoDims = logoImage.scaleToFit(120, 40);
            page.drawImage(logoImage, {
              x: 15,
              y: headerTop - 35,
              width: logoDims.width,
              height: logoDims.height,
            });
            logoDrawn = true;
          }
        } catch (e) {
          console.error("❌ Logo Error:", e.message);
        }
      }
      */

      // --- TEXT HEADER (Replacing Logo) ---
      drawText('KIDDOS INTELLECT', 15, headerTop - 15, 14, fontBold);

      // --- BLUE DART SERVICE HEADER ---
      drawText('BLUE DART', width - 105, headerTop - 5, 14, fontBold, { color: rgb(0, 0, 0.7) });
      drawText('DART APEX', width - 105, headerTop - 20, 10, fontBold);
      drawText('(APEX PREPAID ONLINE)', width - 105, headerTop - 30, 7, fontReg);

      // Line 1
      const line1Y = headerTop - 45; 
      drawLine(line1Y, 1.5);

      // ==========================================
      // 2. BARCODE ZONE (Pushed down for breathing room)
      // ==========================================
      const barcodeY = line1Y - 75; 
      
      try {
        const pngBuffer = await bwipjs.toBuffer({
          bcid: 'code128',
          text: data.awbNumber,
          scale: 3,
          height: 12,
          includetext: true,
          textxalign: 'center',
          textsize: 14,
          paddingheight: 4
        });

        const barcodeImage = await pdfDoc.embedPng(pngBuffer);
        const bcDims = barcodeImage.scale(0.5); 
        const bcX = (width - bcDims.width) / 2;
        
        page.drawImage(barcodeImage, {
          x: bcX,
          y: barcodeY,
          width: bcDims.width,
          height: bcDims.height,
        });
      } catch (err) {
        drawText(data.awbNumber, 50, barcodeY + 20, 18, fontBold);
      }

      // Line 2
      const line2Y = barcodeY - 10; 
      drawLine(line2Y, 1);

      // ==========================================
      // 3. RECIPIENT (TO)
      // ==========================================
      const toY = line2Y - 15; 
      
      drawText('TO:', 15, toY, 9, fontBold);
      drawText(data.consignee.name?.substring(0, 30), 45, toY, 12, fontBold);
      
      const addr = data.consignee.address || '';
      drawText(addr.substring(0, 40), 45, toY - 14, 9);
      drawText(data.consignee.address2?.substring(0, 40) || '', 45, toY - 26, 9);
      
      drawText(`${data.consignee.city} - ${data.consignee.pincode}`, 45, toY - 42, 14, fontBold);
      drawText(`TEL: ${data.consignee.mobile}`, 45, toY - 56, 11, fontBold);

      // Line 3
      const line3Y = toY - 65; 
      drawLine(line3Y, 1);

      // ==========================================
      // 4. SHIPPER (FROM)
      // ==========================================
      const fromY = line3Y - 15; 
      
      drawText('FROM:', 15, fromY, 8, fontBold);
      drawText(data.consigner.name?.substring(0, 35), 50, fromY, 9, fontBold);
      drawText(data.consigner.address?.substring(0, 45), 50, fromY - 12, 8);
      drawText(`SURAT - ${data.consigner.pincode}`, 50, fromY - 24, 8);
      drawText(`M: ${data.consigner.mobile}`, 50, fromY - 36, 8);

      // Line 4
      const line4Y = fromY - 45; 
      drawLine(line4Y, 1);

      // ==========================================
      // 5. CONTENTS (Format: SKU | Title | QUANTITY:- Qty)
      // ==========================================
      const skuY = line4Y - 15;
      drawText('CONTENTS:', 15, skuY, 8, fontBold);

      if (data.items && data.items.length > 0) {
        data.items.slice(0, 2).forEach((item, index) => { 
          const sku = item.sku || 'N/A';
          const shortTitle = (item.title || 'Book').substring(0, 20);
          const contentLine = `${sku} | ${shortTitle} | QUANTITY:- ${item.qty}`;
          
          drawText(contentLine, 65, skuY - (index * 12), 8, fontReg); 
        });
      } else {
        drawText('Educational Books', 65, skuY, 9);
      }

      // Line 5
      const line5Y = 85; 
      drawLine(line5Y, 1);

      // ==========================================
      // 6. FOOTER INFO (Corrected positions)
      // ==========================================
      const infoY = 70; 
      drawText(`DATE: ${new Date().toLocaleDateString('en-IN')}`, 15, infoY, 8);
      drawText(`WT: ${data.weight} KG`, 90, infoY, 8);
      drawText(`VAL: RS.${data.declaredValue}`, 150, infoY, 8); 
      // Moved left to 215 to avoid cutting on the edge
      drawText(`DIMS: 20X15X5`, 215, infoY, 8);

      // ==========================================
      // 7. STATUS BOX
      // ==========================================
      if (data.codAmount > 0) {
        page.drawRectangle({ x: 10, y: 10, width: width - 20, height: 50, borderColor: rgb(0,0,0), borderWidth: 3 });
        drawText('COD AMOUNT TO COLLECT:', 20, 45, 9, fontBold);
        drawText(`RS. ${data.codAmount}/-`, 140, 30, 20, fontBold);
        drawText('(CASH ON DELIVERY)', 20, 20, 8);
      } else {
        page.drawRectangle({ x: 10, y: 10, width: width - 20, height: 50, borderColor: rgb(0,0,0), borderWidth: 2 });
        drawText('PREPAID ORDER', 65, 35, 18, fontBold);
        drawText('DO NOT COLLECT CASH', 90, 20, 9, fontBold);
      }

      const pdfBytes = await pdfDoc.save();
      const fileName = `label-${data.awbNumber}.pdf`;
      const filePath = path.join(this.labelsDir, fileName);
      fs.writeFileSync(filePath, pdfBytes);

      return { success: true, fileName, filePath, buffer: Buffer.from(pdfBytes) };

    } catch (error) {
      console.error('❌ Label Gen Error:', error);
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