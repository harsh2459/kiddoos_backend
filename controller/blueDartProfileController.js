import BlueDartProfile from '../model/BlueDartProfile.js';

// List profiles
export async function listProfiles(req, res, next) {
  try {
    const profiles = await BlueDartProfile.find().sort('-isDefault');
    res.json({ ok: true, profiles });
  } catch (e) { next(e); }
}

// Get single profile
export async function getProfile(req, res, next) {
  try {
    const prof = await BlueDartProfile.findById(req.params.id);
    res.json({ ok: true, profile: prof });
  } catch (e) { next(e); }
}

// Create or update
export async function saveProfile(req, res, next) {
  try {
    const data = req.body;
    if (data.isDefault) {
      await BlueDartProfile.updateMany({}, { isDefault: false });
    }
    let prof;
    if (data._id) {
      prof = await BlueDartProfile.findByIdAndUpdate(data._id, data, { new: true });
    } else {
      prof = await BlueDartProfile.create(data);
    }
    res.json({ ok: true, profile: prof });
  } catch (e) { next(e); }
}

// Delete
export async function deleteProfile(req, res, next) {
  try {
    await BlueDartProfile.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
}
