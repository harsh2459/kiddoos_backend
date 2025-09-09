// routes/shiprocketProfiles.route.js
import { Router } from "express";
import { requireAuth } from "../controller/_middleware/auth.js";
import {
  listProfiles, addProfile, activateProfile,
  refreshToken, deleteProfile, testProfile, updateProfile
} from "../controller/shiprocketProfilescontroller.js";

const r = Router();
r.use(requireAuth(["admin"]));

r.get("/", listProfiles);
r.post("/", addProfile);
r.post("/:id/activate", activateProfile);
r.post("/:id/refresh-token", refreshToken);
r.post("/:id/test", testProfile);
r.put("/:id", updateProfile);
r.delete("/:id", deleteProfile);

export default r;