// backend/routes/labelRoute.js

import express from 'express';
import {
  generateLabel,
  downloadLabel,
  getLabelInfo,
  deleteLabel
} from '../controller/labelController.js';
import { requireAuth } from '../controller/_middleware/auth.js';

const router = express.Router();

// ===== Label Routes

// Generate label (Admin only)
router.post('/generate/:orderId', requireAuth(['admin']), generateLabel);

// Download label (Public)
router.get('/download/:fileName', downloadLabel);

// Get label info (Admin only)
router.get('/info/:fileName', requireAuth(['admin']), getLabelInfo);

// Delete label (Admin only)
router.delete('/:fileName', requireAuth(['admin']), deleteLabel);

export default router;
