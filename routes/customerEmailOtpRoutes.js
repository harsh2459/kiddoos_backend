// backend/routes/customerEmailOtpRoutes.js
import { Router } from "express";
import * as ctrl from "../controller/customerEmailOtpController.js";

const r = Router();

r.post("/start", ctrl.startEmailOtp);     // body: { email }
r.post("/verify", ctrl.verifyEmailOtp);   // body: { email, otp }

export default r;
