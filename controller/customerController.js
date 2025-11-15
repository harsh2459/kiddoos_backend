// backend/controllers/customerController.js
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Customer from "../model/Customer.js";
import Book from "../model/Book.js"; // used for price snapshot
import { sendAbandonedCartEmail } from "../utils/mailer.js";

const TICKET_SECRET = process.env.EMAIL_OTP_JWT_SECRET || "789654123698521478963258741454984651348421646s";
const JWT_SECRET = process.env.JWT_SECRET || "qwertyuioplkjhgfdsazxcvbnm12345678980jfghawfhuqy498554rf3445yt4g5426gt456654y7984gv65864984y16654y98645656465454654465rd14vg68f4165vg14df61g65df4g6514df65g4df65g16df4g6df1g6df4g4";
const JWT_EXPIRES_IN = "7d";

// Debug logging (can remove after it works)
console.log("🔐 [customerController] JWT_SECRET loaded:", JWT_SECRET.substring(0, 20) + "...");
console.log("🔐 [customerController] EMAIL_OTP_JWT_SECRET loaded:", TICKET_SECRET.substring(0, 20) + "...");

/* -------------------------
   Helpers
-------------------------- */

const issueToken = (customer) => {
    const token = jwt.sign({ cid: customer._id }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    console.log("🎟️  [customerController] Issued new token for customer:", customer._id);
    return token;
};


const publicCustomer = (c) => ({
    id: c._id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    preferences: c.preferences,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
});

/* -------------------------
   Auth
-------------------------- */
export const register = async (req, res) => {
    try {
        const { name, email, phone, password, emailOtpTicket } = req.body;
        if (!email && !phone) return res.status(400).json({ error: "Email or phone required" });
        if (!password) return res.status(400).json({ error: "Password required" });

        // If registering with email, OTP ticket is mandatory
        if (email) {
            let payload;
            try {
                payload = jwt.verify(String(emailOtpTicket || ""), TICKET_SECRET);
            } catch {
                return res.status(400).json({ error: "Email not verified" });
            }
            if (!payload || String(payload.email).toLowerCase() !== String(email).toLowerCase()) {
                return res.status(400).json({ error: "Email not verified" });
            }
        }

        // ensure unique
        const exists = await Customer.findOne({
            $or: [{ email: email?.toLowerCase() || "__" }, { phone: phone || "__" }],
        });
        if (exists) return res.status(409).json({ error: "Customer already exists" });

        const passwordHash = await bcrypt.hash(password, 10);
        const customer = await Customer.create({
            name,
            email: email?.toLowerCase() || undefined,
            phone,
            passwordHash,
            // mark verified if they passed the OTP ticket
            emailVerifiedAt: email ? new Date() : null,
        });

        const token = issueToken(customer);
        res.status(201).json({ token, customer: publicCustomer(customer) });
    } catch (err) {
        console.error("register:", err);
        res.status(500).json({ error: "Registration failed" });
    }
};

export const login = async (req, res) => {
    try {
        const { email, phone, password } = req.body;
        if (!password) return res.status(400).json({ error: "Password required" });

        const customer = await Customer.findOne(
            email ? { email: email.toLowerCase() } : { phone }
        );
        if (!customer) return res.status(404).json({ error: "Customer not found" });

        const ok = await bcrypt.compare(password, customer.passwordHash);
        if (!ok) return res.status(401).json({ error: "Invalid credentials" });

        const token = issueToken(customer);
        res.json({ token, customer: publicCustomer(customer) });
    } catch (err) {
        console.error("login:", err);
        res.status(500).json({ error: "Login failed" });
    }
};

export const me = async (req, res) => {
    try {
        const c = await Customer.findById(req.customerId);
        if (!c) return res.status(404).json({ error: "Not found" });
        res.json({ customer: publicCustomer(c) });
    } catch (err) {
        res.status(500).json({ error: "Failed" });
    }
};

export const updateProfile = async (req, res) => {
    try {
        const { name, preferences } = req.body;
        const c = await Customer.findById(req.customerId);
        if (!c) return res.status(404).json({ error: "Not found" });

        if (name) c.name = name;
        if (preferences) c.preferences = { ...c.preferences, ...preferences };
        await c.save();

        res.json({ customer: publicCustomer(c) });
    } catch (err) {
        res.status(500).json({ error: "Update failed" });
    }
};

/* -------------------------
   Cart
-------------------------- */

// GET cart
export const getCart = async (req, res) => {
    try {
        const c = await Customer.findById(req.customerId)
            .populate("cart.items.bookId"); // Get ALL fields
        
        if (!c) return res.status(404).json({ error: "Not found" });
        
        res.json({ cart: c.cart, abandoned: c.abandoned });
    } catch (err) {
        console.error("getCart error:", err);
        res.status(500).json({ error: "Failed to get cart" });
    }
};

// ✅ Add/replace an item in cart (upsert)
export const addToCart = async (req, res) => {
    try {
        const { bookId, qty } = req.body;
        if (!bookId || !qty || qty < 1) {
            return res.status(400).json({ error: "bookId & qty>=1 required" });
        }

        const c = await Customer.findById(req.customerId);
        if (!c) return res.status(404).json({ error: "Not found" });

        // Price snapshot from Book
        const book = await Book.findById(bookId).select("price");
        const unitPriceSnapshot = Number(book?.price || 0);

        const idx = c.cart.items.findIndex((it) => String(it.bookId) === String(bookId));
        if (idx >= 0) {
            c.cart.items[idx].qty = qty;
            c.cart.items[idx].unitPriceSnapshot = unitPriceSnapshot;
            c.cart.items[idx].updatedAt = new Date();
        } else {
            c.cart.items.push({ 
                bookId, 
                qty, 
                unitPriceSnapshot, 
                addedAt: new Date() 
            });
        }

        c.touchCartActivity("add/update");
        c.recalculateCartTotals();
        c.startAbandonedProgramIfNeeded();

        await c.save();
        
        // ✅ CRITICAL: Populate before response
        await c.populate("cart.items.bookId");
        
        res.json({ cart: c.cart });
    } catch (err) {
        console.error("addToCart:", err);
        res.status(500).json({ error: "Failed to add to cart" });
    }
};

// ✅ Update quantity only
export const setCartItemQty = async (req, res) => {
    try {
        const { itemId, qty } = req.body;
        if (!itemId || qty == null) {
            return res.status(400).json({ error: "itemId & qty required" });
        }

        const c = await Customer.findById(req.customerId);
        if (!c) return res.status(404).json({ error: "Not found" });

        const item = c.cart.items.id(itemId);
        if (!item) return res.status(404).json({ error: "Item not found" });

        if (qty < 1) {
            item.deleteOne();
        } else {
            item.qty = qty;
            item.updatedAt = new Date();
        }

        c.touchCartActivity("qty");
        c.recalculateCartTotals();

        if (c.cart.items.length === 0) {
            c.resetAbandonedProgram("cart cleared");
            c.cart.expiresAt = null;
        }

        await c.save();
        
        // ✅ CRITICAL: Populate before response
        await c.populate("cart.items.bookId");
        
        res.json({ cart: c.cart });
    } catch (err) {
        console.error("setCartItemQty:", err);
        res.status(500).json({ error: "Failed to update qty" });
    }
};

// ✅ Remove one item
export const removeCartItem = async (req, res) => {
    try {
        const { itemId } = req.params;
        const c = await Customer.findById(req.customerId);
        if (!c) return res.status(404).json({ error: "Not found" });

        const item = c.cart.items.id(itemId);
        if (!item) return res.status(404).json({ error: "Item not found" });

        item.deleteOne();
        c.touchCartActivity("remove");
        c.recalculateCartTotals();

        if (c.cart.items.length === 0) {
            c.resetAbandonedProgram("cart cleared");
            c.cart.expiresAt = null;
        }

        await c.save();
        
        // ✅ CRITICAL: Populate before response
        await c.populate("cart.items.bookId");
        
        res.json({ cart: c.cart });
    } catch (err) {
        console.error("removeCartItem:", err);
        res.status(500).json({ error: "Failed to remove item" });
    }
};

// ✅ Clear entire cart
export const clearCart = async (req, res) => {
    try {
        const c = await Customer.findById(req.customerId);
        if (!c) return res.status(404).json({ error: "Not found" });

        c.cart.items = [];
        c.cart.totals = { subTotal: 0, taxAmount: 0, shippingAmount: 0, grandTotal: 0 };
        c.cart.lastActivityAt = new Date();
        c.cart.expiresAt = null;
        c.resetAbandonedProgram("manual clear");

        await c.save();
        res.json({ cart: c.cart });
    } catch (err) {
        console.error("clearCart error:", err);
        res.status(500).json({ error: "Failed to clear cart" });
    }
};

/* -------------------------
   Preferences
-------------------------- */
export const setCartRemindersOptIn = async (req, res) => {
    const { enabled } = req.body; // boolean
    const c = await Customer.findById(req.customerId);
    if (!c) return res.status(404).json({ error: "Not found" });
    c.preferences.cartReminders = !!enabled;

    // If turned off, stop program
    if (!enabled) c.resetAbandonedProgram("opt-out");

    await c.save();
    res.json({ preferences: c.preferences, abandoned: c.abandoned });
};

/* -------------------------
   Abandoned Cart Sweep (cron-safe)
   - Send 1 email/day up to 7 days
   - After completion or expiry (7 days), clear cart
-------------------------- */
export const runAbandonedCartSweep = async () => {
    const now = new Date();

    // 1) SEND EMAILS DUE
    const dueToSend = await Customer.find({
        "abandoned.active": true,
        "abandoned.completed": { $ne: true },
        "abandoned.nextSendAt": { $lte: now },
        "preferences.cartReminders": true,
        "cart.items.0": { $exists: true },
    }).limit(200);

    for (const c of dueToSend) {
        try {
            //   await sendAbandonedCartEmail(c); // implement your template + links
            const day = Math.min(7, Math.max(1, (c.abandoned?.sendCount || 0) + 1));
            await sendAbandonedCartEmail(c, day);
            c.recordAbandonedReminderSent();
            await c.save();
        } catch (err) {
            console.error("abandoned-send-failed:", c._id, err?.message);
            // still schedule next day to avoid stuck state
            if (c.abandoned?.active && !c.abandoned.completed) {
                c.abandoned.nextSendAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
                await c.save();
            }
        }
    }

    // 2) CLEAR EXPIRED CARTS (7 days from last activity)
    const toExpire = await Customer.find({
        $or: [
            { "cart.expiresAt": { $lte: now } },
            { "abandoned.completed": true, "abandoned.sendCount": { $gte: 7 } },
        ],
        "cart.items.0": { $exists: true },
    }).limit(500);

    for (const c of toExpire) {
        c.cart.items = [];
        c.cart.totals = { subTotal: 0, taxAmount: 0, shippingAmount: 0, grandTotal: 0 };
        c.cart.lastActivityAt = now;
        c.cart.expiresAt = null;
        c.resetAbandonedProgram("expired");
        await c.save();
    }
    return { sent: dueToSend.length, expired: toExpire.length };
};