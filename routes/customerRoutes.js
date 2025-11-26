// backend/routes/customerRoutes.js
import { Router } from "express";
import authCustomer from "../controller/_middleware/authCustomer.js"; // <-- make sure folder is controllers/
import {
  register, login, me, updateProfile,
  getCart, addToCart, setCartItemQty, removeCartItem, clearCart,
  setCartRemindersOptIn,getMyOrders,googleLogin
} from "../controller/customerController.js";
import customerEmailOtpRoutes from "./customerEmailOtpRoutes.js";
const r = Router();

r.use("/auth/email-otp", customerEmailOtpRoutes);
r.post("/auth/register", register);
r.post("/auth/login", login);
r.post("/auth/google", googleLogin);
r.get("/me", authCustomer, me);
r.patch("/me", authCustomer, updateProfile);
r.get("/orders", authCustomer, getMyOrders);
r.get("/cart", authCustomer, getCart);
r.post("/cart/add", authCustomer, addToCart);
r.patch("/cart/qty", authCustomer, setCartItemQty);
r.delete("/cart/item/:itemId", authCustomer, removeCartItem);
r.delete("/cart/clear", authCustomer, clearCart);

r.post("/prefs/cart-reminders", authCustomer, setCartRemindersOptIn);

export default r;
