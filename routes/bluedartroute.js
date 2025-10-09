import Router from 'express';
import { requireAuth } from '../controller/_middleware/auth.js';
import { bdCreateOrders, bdTrackAwb, bdSchedulePickup, bdCancelShipment } from '../controller/bluedartcontroller.js';

const router = Router();

router.use(requireAuth('admin'));

router.post('/orders/create', bdCreateOrders);
router.get('/track/:awb', bdTrackAwb);
router.post('/pickup', bdSchedulePickup);
router.post('/cancel', bdCancelShipment);

export default router;
 