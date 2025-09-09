// controller/shiprocketProfilescontroller.js
import mongoose from "mongoose";
import User from "../model/User.js";
import { encrypt, decrypt } from "./_services/crypto.js";
import { srLogin } from "./_services/shiprocket.js";


// UTIL: return profiles array safely
async function getProfiles(userId) {

    const u = await User.findById(userId)
        .select("integrations.shiprocket.profiles")
        .lean();
    return u?.integrations?.shiprocket?.profiles || [];
}
async function ensureShiprocketPath(userId) {
    // If integrations.shiprocket missing, create it with empty profiles array
    await User.updateOne(
        { _id: userId, "integrations.shiprocket": { $exists: false } },
        { $set: { "integrations.shiprocket": { profiles: [] } } }
    );
}

// GET /api/shiprocket/profiles
export async function listProfiles(req, res, next) {
    try {
        const userId = req.user?._id || req.user?.id;
        const profiles = await getProfiles(userId);
        // Don't return encrypted passwords
        const sanitizedProfiles = profiles.map(profile => ({
            _id: profile._id,
            label: profile.label,
            email: profile.email,
            pickupLocation: profile.pickupLocation,
            defaults: profile.defaults,
            auth: {
                expiresAt: profile.auth?.expiresAt
            },
            active: profile.active,
            createdAt: profile.createdAt,
            updatedAt: profile.updatedAt
        }));

        res.json({ ok: true, profiles: sanitizedProfiles });
    } catch (e) { next(e); }
}

// POST /api/shiprocket/profiles
export async function addProfile(req, res, next) {
    try {
        const { label, email, password, pickupLocation, defaults } = req.body || {};
        const userId = req.user?._id || req.user?.id;

        if (!label || !email || !password) {
            return res.status(400).json({ ok: false, error: "label, email, and password are required" });
        }

        // Check if label already exists
        const existingProfiles = await getProfiles(userId);
        if (existingProfiles.some(p => p.label === label)) {
            return res.status(400).json({ ok: false, error: "A profile with this label already exists" });
        }

        const profileDoc = {
            _id: new mongoose.Types.ObjectId(),
            label,
            email,
            passwordEnc: encrypt(password),
            pickupLocation: pickupLocation || "Default",
            defaults: {
                weight: Number(defaults?.weight ?? 0.5),
                length: Number(defaults?.length ?? 20),
                breadth: Number(defaults?.breadth ?? 15),
                height: Number(defaults?.height ?? 3),
            },
            auth: {
                token: null,
                expiresAt: null
            },
            active: existingProfiles.length === 0 // Activate if first profile
        };

        await ensureShiprocketPath(userId);
        const r = await User.updateOne({ _id: userId }, { $push: { "integrations.shiprocket.profiles": profileDoc } });
        // Optional: log to verify
        console.log("addProfile updateOne result:", r);
        const profiles = await getProfiles(userId);

        res.json({ ok: true, profiles });
    } catch (e) { next(e); }
}

// POST /api/shiprocket/profiles/:id/activate
export async function activateProfile(req, res, next) {
    try {
        const userId = req.user?._id || req.user?.id;
        const { id } = req.params;
        const profiles = await getProfiles(userId);
        const updated = profiles.map(p => ({
            ...p,
            active: String(p._id) === String(id)
        }));
        await User.updateOne({ _id: userId }, { $set: { "integrations.shiprocket.profiles": updated } });
        res.json({ ok: true, profiles: updated });

    } catch (e) { next(e); }
}

// POST /api/shiprocket/profiles/:id/refresh-token
export async function refreshToken(req, res, next) {
    try {
        const userId = req.user?._id || req.user?.id;
        const { id } = req.params;

        const user = await User.findById(userId)
            .select("integrations.shiprocket.profiles")
            .lean();

        const profiles = user?.integrations?.shiprocket?.profiles || [];
        const profile = profiles.find(p => String(p._id) === String(id));

        if (!profile) {
            return res.status(404).json({ ok: false, error: "Profile not found" });
        }

        // Use profile credentials to login
        const token = await srLogin({
            email: profile.email,
            password: decrypt(profile.passwordEnc)
        });

        // Token expires in 10 days (240 hours)
        const expiresAt = new Date(Date.now() + 240 * 3600 * 1000);

        await User.updateOne(
            { _id: userId, "integrations.shiprocket.profiles._id": id },
            {
                $set: {
                    "integrations.shiprocket.profiles.$.auth.token": token,
                    "integrations.shiprocket.profiles.$.auth.expiresAt": expiresAt
                }
            }
        );

        const updatedProfiles = await getProfiles(userId);
        res.json({ ok: true, profiles: updatedProfiles });
    } catch (e) { next(e); }
}

// DELETE /api/shiprocket/profiles/:id
export async function deleteProfile(req, res, next) {
    try {
        const { id } = req.params;

        await User.updateOne(
            { _id: req.user._id },
            { $pull: { "integrations.shiprocket.profiles": { _id: new mongoose.Types.ObjectId(id) } } }
        );

        const profiles = await getProfiles(req.user._id);
        res.json({ ok: true, profiles });
    } catch (e) { next(e); }
}

// Test profile credentials
export async function testProfile(req, res, next) {
    try {
        const { id } = req.params;
        const user = await User.findById(req.user?._id || req.user?.id)
            .select("integrations.shiprocket.profiles")
            .lean();

        const profiles = user?.integrations?.shiprocket?.profiles || [];
        const profile = profiles.find(p => String(p._id) === id);

        if (!profile) {
            return res.status(404).json({ ok: false, error: "Profile not found" });
        }

        // Test login with profile credentials
        const token = await srLogin({
            email: profile.email,
            password: decrypt(profile.passwordEnc)
        });

        res.json({ ok: true, message: "Credentials are valid" });
    } catch (e) {
        res.status(400).json({ ok: false, error: "Invalid credentials: " + e.message });
    }
}

// Update profile
export async function updateProfile(req, res, next) {
    try {
        const { id } = req.params;
        const { label, email, password, pickupLocation, defaults } = req.body || {};

        const updateData = {};
        if (label !== undefined) updateData["integrations.shiprocket.profiles.$.label"] = label;
        if (email !== undefined) updateData["integrations.shiprocket.profiles.$.email"] = email;
        if (pickupLocation !== undefined) updateData["integrations.shiprocket.profiles.$.pickupLocation"] = pickupLocation;
        if (defaults !== undefined) {
            updateData["integrations.shiprocket.profiles.$.defaults.weight"] = Number(defaults?.weight ?? 0.5);
            updateData["integrations.shiprocket.profiles.$.defaults.length"] = Number(defaults?.length ?? 20);
            updateData["integrations.shiprocket.profiles.$.defaults.breadth"] = Number(defaults?.breadth ?? 15);
            updateData["integrations.shiprocket.profiles.$.defaults.height"] = Number(defaults?.height ?? 3);
        }

        if (password) {
            updateData["integrations.shiprocket.profiles.$.passwordEnc"] = encrypt(password);
            // Invalidate existing token when password changes
            updateData["integrations.shiprocket.profiles.$.auth"] = { token: null, expiresAt: new Date(0) };
        }

        await User.updateOne(
            { _id: req.user._id, "integrations.shiprocket.profiles._id": id },
            { $set: updateData }
        );

        const profiles = await getProfiles(req.user._id);
        res.json({ ok: true, profiles });
    } catch (e) { next(e); }
}