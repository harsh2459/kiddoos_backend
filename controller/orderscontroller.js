import crypto from 'crypto';
import mongoose from "mongoose";
import Order from "../model/Order.js";
import Customer from "../model/Customer.js";
import { sendBySlug } from "../utils/mailer.js";
import Book from "../model/Book.js";

export async function onOrderPaid(order) {
  try {
    const customer = await Customer.findById(order.customerId);
    if (!customer) return;

    // Clear cart after successful order
    customer.resetAbandonedProgram("order placed");
    customer.cart.items = [];
    customer.cart.totals = { subTotal: 0, taxAmount: 0, shippingAmount: 0, grandTotal: 0 };
    customer.cart.expiresAt = null;
    await customer.save();

    // Send order email
    await sendBySlug("order_paid", customer.email, {
      name: customer.name || "there",
      order_id: order._id,
      amount: order.amount,
      items: order.items?.length || 0,
      order_date: new Date(order.createdAt).toLocaleDateString('en-IN'),
    });

  } catch (e) {
    console.error("order-paid-email-failed", e?.message || e);
  }
}

export async function createOrder(req, res, next) {
  try {
    // ✅ Extract shippingFee and serviceFee separately
    let { customerId, customer, items, shipping, payment, totals, amount, currency, shippingFee, serviceFee } = req.body;

    console.log("\n" + "=".repeat(80));
    console.log("🛒 [CreateOrder] Processing new order...");
    console.log("=".repeat(80));

    // 1. Guest Customer Logic
    if (!customerId && customer) {
      let existingCustomer = await Customer.findOne({
        $or: [{ phone: customer.phone }, ...(customer.email ? [{ email: customer.email }] : [])].filter(Boolean)
      });
      if (!existingCustomer) {
        const tempPassword = crypto.randomBytes(8).toString('hex');
        const passwordHash = crypto.createHash('sha256').update(tempPassword).digest('hex');
        existingCustomer = new Customer({
          name: customer.name || "",
          email: (customer.email && customer.email.trim() !== "") ? customer.email : undefined,
          phone: customer.phone || "",
          passwordHash,
          isGuest: true,
          emailVerified: false
        });
        await existingCustomer.save();
      }
      customerId = existingCustomer._id;
    }

    if (!customerId || !items?.length) {
      return res.status(400).json({ ok: false, error: "Missing customer or items" });
    }

    // 2. Fetch Books
    const bookIds = items.map(i => String(i.bookId || i._id)).filter(id => mongoose.Types.ObjectId.isValid(id));
    if (bookIds.length === 0) return res.status(400).json({ ok: false, error: "No valid book IDs" });

    const dbBooks = await Book.find({ _id: { $in: bookIds.map(id => new mongoose.Types.ObjectId(id)) } }).lean();
    const bookMap = {};
    dbBooks.forEach(b => { bookMap[String(b._id)] = b; });

    const validItems = items.map((item) => {
      const rawId = String(item.bookId || item._id);
      const dbBook = bookMap[rawId];
      let imgUrl = "";
      if (dbBook?.assets?.coverUrl) {
        imgUrl = Array.isArray(dbBook.assets.coverUrl) ? dbBook.assets.coverUrl[0] : dbBook.assets.coverUrl;
      }
      return {
        bookId: rawId,
        qty: Number(item.qty) || 1,
        unitPrice: Number(item.price) > 0 ? Number(item.price) : (dbBook?.price || 0),
        title: dbBook?.title || item.title || "Unknown Item",
        image: imgUrl || ""
      };
    });

    // 3. Construct Order Data
    let paymentStatus = "pending";
    if (payment?.status === "created") paymentStatus = "pending";
    else if (["pending", "paid", "failed"].includes(payment?.status)) paymentStatus = payment.status;

    const orderData = {
      userId: customerId,
      items: validItems,
      amount: amount || totals?.grandTotal || 0,
      taxAmount: totals?.taxAmount || 0,
      
      // ✅ Map frontend fees to DB fields correctly
      shippingAmount: shippingFee || 0,
      serviceFee: serviceFee || 0,

      payment: {
        provider: payment?.provider || "razorpay",
        mode: "full",
        status: paymentStatus,
        orderId: payment?.orderId || "",
        paymentId: payment?.paymentId || "",
        signature: payment?.signature || "",
        paidAmount: 0,
        dueAmount: amount || totals?.grandTotal || 0,
        dueOnDeliveryAmount: 0,
        codSettlementStatus: "na"
      },
      email: customer?.email || "",
      phone: customer?.phone || "",
      shipping: {
        name: customer?.name || "",
        phone: customer?.phone || "",
        email: customer?.email || "",
        address: shipping?.address1 || "",
        city: shipping?.city || "",
        state: shipping?.state || "",
        pincode: shipping?.postalCode || "",
        country: shipping?.country || "India",
        provider: null,
        bd: { codAmount: 0, logs: [] }
      },
      status: "pending",
      transactions: []
    };

    const order = new Order(orderData);

    // Payment Mode Logic
    const isHalfPayment = payment?.method === "half_online_half_cod" || payment?.method === "half_cod_half_online";
    if (isHalfPayment) {
      order.payment.paymentType = "half_online_half_cod";
      order.applyPaymentMode("half");
    } else {
      order.applyPaymentMode("full");
    }

    await order.save();
    console.log('✅ [CreateOrder] SUCCESS! Order created:', order._id);
    res.json({ ok: true, order, orderId: order._id, _id: order._id });

  } catch (e) {
    console.error("❌ [CreateOrder] ERROR:", e);
    next(e);
  }
}

export const listOrders = async (req, res, next) => {
  try {
    const {
      q = "",
      status = "",
      page = 1,
      limit = 20,
      startDate,
      endDate
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where = {};

    // ✅ ENHANCED SEARCH - Search across ALL fields
    if (q && q.trim()) {
      const searchTerm = q.trim();
      console.log("🔍 Searching for:", searchTerm);

      const searchConditions = [];

      // 1. Search by Order ID (last 8 characters or full ObjectId)
      try {
        // Check if it's a full valid ObjectId (24 hex characters)
        if (/^[0-9a-fA-F]{24}$/.test(searchTerm)) {
          searchConditions.push({ _id: new mongoose.Types.ObjectId(searchTerm) });
          console.log("✅ Searching by full ObjectId");
        } 
        // Search by partial ID (e.g., last 8 characters like "07b11ec8")
        else if (searchTerm.length >= 6) {
          // Fetch all order IDs and filter by matching end
          const allOrders = await Order.find({}).select('_id').lean();
          const matchingIds = allOrders
            .filter(o => {
              const idStr = String(o._id).toLowerCase();
              return idStr.endsWith(searchTerm.toLowerCase()) || 
                     idStr.includes(searchTerm.toLowerCase());
            })
            .map(o => o._id);
          
          if (matchingIds.length > 0) {
            searchConditions.push({ _id: { $in: matchingIds } });
            console.log(`✅ Found ${matchingIds.length} orders matching ID pattern`);
          }
        }
      } catch (err) {
        console.log("⚠️ Order ID search skipped:", err.message);
      }

      // 2. Search customer info (most common searches)
      searchConditions.push(
        { email: { $regex: searchTerm, $options: "i" } },
        { phone: { $regex: searchTerm, $options: "i" } },
        { "shipping.name": { $regex: searchTerm, $options: "i" } },
        { "shipping.phone": { $regex: searchTerm, $options: "i" } },
        { "shipping.email": { $regex: searchTerm, $options: "i" } },
        { "shipping.address": { $regex: searchTerm, $options: "i" } },
        { "shipping.city": { $regex: searchTerm, $options: "i" } },
        { "shipping.state": { $regex: searchTerm, $options: "i" } },
        { "shipping.pincode": { $regex: searchTerm, $options: "i" } }
      );

      // 3. Search by book title (in items array)
      searchConditions.push(
        { "items.title": { $regex: searchTerm, $options: "i" } }
      );

      // 4. Search by AWB number
      searchConditions.push(
        { "shipping.bd.awbNumber": { $regex: searchTerm, $options: "i" } }
      );

      // 5. Search by payment IDs
      searchConditions.push(
        { "payment.orderId": { $regex: searchTerm, $options: "i" } },
        { "payment.paymentId": { $regex: searchTerm, $options: "i" } }
      );

      // 6. Search by amount (if numeric)
      if (/^\d+$/.test(searchTerm)) {
        const numericAmount = parseInt(searchTerm);
        searchConditions.push(
          { amount: numericAmount },
          { "payment.paidAmount": numericAmount },
          { "payment.dueOnDeliveryAmount": numericAmount }
        );
      }

      where.$or = searchConditions;
    }

    // Status filter
    if (status) {
      where.status = status;
    }

    // Date range filter
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        where.createdAt.$lte = new Date(endDate);
      }
    }

    console.log("📋 Final query:", JSON.stringify(where, null, 2));

    // Get total count
    const total = await Order.countDocuments(where);

    // Get orders with populated fields
    const orders = await Order.find(where)
      .populate("userId", "name email phone")
      .populate("items.bookId", "title assets")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    console.log(`✅ Found ${orders.length} orders (total: ${total})`);

    res.json({
      ok: true,
      items: orders,
      orders: orders,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit))
    });

  } catch (error) {
    console.error("❌ List orders error:", error);
    next(error);
  }
};

export async function getOrder(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid order ID format"
      });
    }

    const order = await Order.findById(id)
      .populate('userId', 'name email phone');

    if (!order) {
      return res.status(404).json({
        ok: false,
        error: "Order not found"
      });
    }

    res.json({
      ok: true,
      order
    });

  } catch (e) {
    console.error("❌ Get order error:", e);
    next(e);
  }
}

export async function updateOrder(req, res, next) {
  try {
    const { id } = req.params;
    const updateData = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid order ID format"
      });
    }

    // Remove fields that shouldn't be updated directly
    delete updateData._id;
    delete updateData.userId;
    delete updateData.createdAt;

    const order = await Order.findByIdAndUpdate(
      id,
      {
        ...updateData,
        updatedAt: new Date()
      },
      { new: true }
    ).populate('userId', 'name email phone');

    if (!order) {
      return res.status(404).json({
        ok: false,
        error: "Order not found"
      });
    }

    // If order status changed to paid, trigger paid logic
    if (updateData.status === 'paid') {
      await onOrderPaid(order);
    }

    res.json({
      ok: true,
      order
    });

  } catch (e) {
    console.error("❌ Update order error:", e);
    next(e);
  }
}

export async function deleteOrder(req, res, next) {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid order ID format"
      });
    }

    const order = await Order.findByIdAndDelete(id);

    if (!order) {
      return res.status(404).json({
        ok: false,
        error: "Order not found"
      });
    }

    res.json({
      ok: true,
      message: "Order deleted successfully",
      deletedOrder: order
    });

  } catch (e) {
    console.error("❌ Delete order error:", e);
    next(e);
  }
}

// Export additional helper functions
export async function getOrdersByCustomer(req, res, next) {
  try {
    const { customerId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid customer ID format"
      });
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const orders = await Order.find({ userId: customerId }) // ✅ Fixed: userId
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Order.countDocuments({ userId: customerId }); // ✅ Fixed: userId

    res.json({
      ok: true,
      orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });

  } catch (e) {
    console.error("❌ Get orders by customer error:", e);
    next(e);
  }
}

export async function updateOrderStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid order ID format"
      });
    }

    const validStatuses = ['pending', 'paid', 'shipped', 'delivered', 'refunded']; // ✅ Schema enum
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid status. Must be one of: " + validStatuses.join(', ')
      });
    }

    const order = await Order.findByIdAndUpdate(
      id,
      {
        status,
        ...(notes && { notes }),
        updatedAt: new Date()
      },
      { new: true }
    ).populate('userId', 'name email phone');

    if (!order) {
      return res.status(404).json({
        ok: false,
        error: "Order not found"
      });
    }

    // Trigger specific actions based on status
    if (status === 'paid') {
      await onOrderPaid(order);
    }

    res.json({
      ok: true,
      order,
      message: `Order status updated to ${status}`
    });

  } catch (e) {
    console.error("❌ Update order status error:", e);
    next(e);
  }
}
