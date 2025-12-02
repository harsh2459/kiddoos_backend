// backend/controller/labelController.js

import Order from '../model/Order.js';
import BlueDartLabel from './_services/bluedart-label.js';

// Generate Label PDF from Blue Dart API
export const generateLabel = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Order not found' });

    const bd = order.shipping?.bd || {};

    if (!bd.awbNumber) {
      return res.status(400).json({ ok: false, error: 'Shipment not created yet.' });
    }

    // Check if we have the URL stored
    if (bd.labelUrl) {
      return res.json({
        ok: true,
        message: 'Label retrieved successfully',
        data: {
          awbNumber: bd.awbNumber,
          downloadUrl: bd.labelUrl // Returns https://res.cloudinary.com/...
        }
      });
    }

    // If AWB exists but no label URL, it means upload failed previously 
    // or API didn't return content.
    return res.status(404).json({ 
      ok: false, 
      error: 'Label URL not found. The shipment is booked, but the label failed to upload or was not provided by BlueDart.' 
    });

  } catch (error) {
    console.error('❌ Label Error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Download Label PDF
export const downloadLabel = async (req, res) => {
  try {
    const { fileName } = req.params;

    // Use the service to check if file exists
    const result = await BlueDartLabel.getLabel(fileName);

    if (!result.success) {
      return res.status(404).json({ ok: false, error: 'Label file not found on server' });
    }

    // Construct full URL based on your server config
    // Since app.js serves '/uploads', the URL is consistent
    const fileUrl = `/uploads/labels/${fileName}`;

    res.json({
      ok: true,
      url: fileUrl,
      fileName: fileName
    });

  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Get Label Info
export const getLabelInfo = async (req, res) => {
  try {
    const { fileName } = req.params;
    const result = await BlueDartLabel.getLabel(fileName);
    
    if (!result.success) return res.status(404).json({ ok: false, error: result.error });

    res.json({ ok: true, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

// ✅ 4. Delete Label
export const deleteLabel = async (req, res) => {
  try {
    const { fileName } = req.params;
    const result = await BlueDartLabel.deleteLabel(fileName);

    if (!result.success) return res.status(400).json({ ok: false, error: result.error });

    res.json({ ok: true, message: 'Label deleted successfully' });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
};

export default {
  generateLabel,
  downloadLabel,
  getLabelInfo,
  deleteLabel
};
