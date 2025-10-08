import Router from 'express';
import { requireAuth } from '../controller/_middleware/auth.js';
import {
  listProfiles, getProfile, saveProfile, deleteProfile
} from '../controller/blueDartProfileController.js';

const router = Router();
router.use(requireAuth('admin'));

router.get('/', listProfiles);
router.get('/:id', getProfile);
router.post('/', saveProfile);
router.delete('/:id', deleteProfile);

export default router;
