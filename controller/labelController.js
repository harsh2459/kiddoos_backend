// backend/controller/labelController.js

import Order from '../model/Order.js';
import BlueDartLabel from './_services/bluedart-label.js';

// Generate Label PDF from Blue Dart API
export const generateLabel = async (req, res) => {
  try {
    const { orderId } = req.params;

    // Validate input
    if (!orderId) {
      return res.status(400).json({
        ok: false,
        error: 'Order ID is required'
      });
    }

    // Get order
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        ok: false,
        error: 'Order not found'
      });
    }

    // Check if shipment exists
    if (!order.shipping || !order.shipping.blueDart || !order.shipping.blueDart.awbNumber) {
      return res.status(400).json({
        ok: false,
        error: 'No shipment found for this order. Please create shipment first.'
      });
    }

    const awbNumber = order.shipping.blueDart.awbNumber;

    // Get label from Blue Dart API
    const labelResult = await BlueDartLabel.getLabelFromBlueDart(awbNumber);

    if (!labelResult.success) {
      return res.status(400).json({
        ok: false,
        error: labelResult.error || 'Failed to generate label'
      });
    }

    // Update order with label information
    await Order.findByIdAndUpdate(
      orderId,
      {
        $set: {
          'shipping.blueDart.labelUrl': labelResult.url,
          'shipping.blueDart.labelFileName': labelResult.fileName,
          'shipping.blueDart.labelGeneratedAt': new Date(),
          'shipping.blueDart.labelStatus': 'generated'
        }
      },
      { new: true }
    );

    console.log('✅ [Controller] Label generated and updated in DB:', orderId);

    res.json({
      ok: true,
      message: 'Label generated successfully',
      data: {
        orderId: orderId,
        awbNumber: awbNumber,
        fileName: labelResult.fileName,
        url: labelResult.url,
        downloadUrl: `/api/labels/download/${labelResult.fileName}`,
        generatedAt: labelResult.savedAt
      }
    });
  } catch (error) {
    console.error('❌ [Controller] Generate label error:', error);

    res.status(500).json({
      ok: false,
      error: error.message || 'Error generating label'
    });
  }
};

// Download Label PDF
export const downloadLabel = async (req, res) => {
  try {
    const { fileName } = req.params;

    // Validate input
    if (!fileName) {
      return res.status(400).json({
        ok: false,
        error: 'File name is required'
      });
    }

    // Get label file
    const result = await BlueDartLabel.getLabel(fileName);

    if (!result.success) {
      return res.status(404).json({
        ok: false,
        error: result.error || 'Label not found'
      });
    }

    // Download file
    res.download(result.filePath, `shipping-label-${fileName}.pdf`, (err) => {
      if (err) {
        console.error('❌ [Controller] Download error:', err);
      } else {
        console.log('✅ [Controller] Label downloaded:', fileName);
      }
    });
  } catch (error) {
    console.error('❌ [Controller] Download error:', error);

    res.status(500).json({
      ok: false,
      error: error.message || 'Error downloading label'
    });
  }
};

// Get Label Info
export const getLabelInfo = async (req, res) => {
  try {
    const { fileName } = req.params;

    if (!fileName) {
      return res.status(400).json({
        ok: false,
        error: 'File name is required'
      });
    }

    const result = await BlueDartLabel.getLabel(fileName);

    if (!result.success) {
      return res.status(404).json({ 
        ok: false,
        error: result.error || 'Label not found'
      });
    }
    
    res.json({
      ok: true,
      data: {
        fileName: result.fileName,
        url: `/uploads/labels/${result.fileName}`,
        downloadUrl: `/api/labels/download/${result.fileName}`
      }
    });
  } catch (error) {
    console.error('❌ [Controller] Get label info error:', error);

    res.status(500).json({
      ok: false,
      error: error.message || 'Error getting label info'
    });
  }
};

// Delete Label
export const deleteLabel = async (req, res) => {
  try {
    const { fileName } = req.params;

    if (!fileName) {
      return res.status(400).json({
        ok: false,
        error: 'File name is required'
      });
    }

    const result = await BlueDartLabel.deleteLabel(fileName);

    if (!result.success) {
      return res.status(404).json(result);
    }

    res.json({
      ok: true,
      message: result.message || 'Label deleted successfully'
    });
  } catch (error) {
    console.error('❌ [Controller] Delete error:', error);

    res.status(500).json({
      ok: false,
      error: error.message || 'Error deleting label'
    });
  }
};

export default {
  generateLabel,
  downloadLabel,
  getLabelInfo,
  deleteLabel
};
