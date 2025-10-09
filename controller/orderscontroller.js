import crypto from 'crypto';
import mongoose from "mongoose";
import Order from "../model/Order.js";
import Customer from "../model/Customer.js";
import { sendBySlug } from "../utils/mailer.js";

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
      amount: order.totals?.grandTotal || order.amount,
      items: order.items?.length || 0,
      order_date: new Date(order.createdAt).toLocaleDateString('en-IN'),
    });

  } catch (e) {
    console.error("order-paid-email-failed", e?.message || e);
  }
}

export async function createOrder(req, res, next) {
  try {
    let { customerId, customer, items, shipping, payment, totals, amount, currency } = req.body;
    
    // ✅ Handle both customerId (existing) and customer object (guest)
    if (!customerId && customer) {
      // Create or find customer first
      let existingCustomer = await Customer.findOne({
        $or: [
          { phone: customer.phone },
          ...(customer.email ? [{ email: customer.email }] : [])
        ].filter(Boolean)
      });
      
      if (!existingCustomer) {
        // ✅ Create guest customer with simple password hash
        const tempPassword = crypto.randomBytes(8).toString('hex');
        const passwordHash = crypto.createHash('sha256').update(tempPassword).digest('hex');

        existingCustomer = new Customer({
          name: customer.name || "",
          email: customer.email || "",
          phone: customer.phone || "",
          passwordHash, // ✅ Required field for schema
          isGuest: true,
          emailVerified: false
        });
        
        await existingCustomer.save();
        console.log('✅ Created guest customer:', existingCustomer._id);
      }
      
      customerId = existingCustomer._id;
    }
    
    if (!customerId || !items?.length) {
      return res.status(400).json({
        ok: false,
        error: "Missing customer information or items"
      });
    }

    // ✅ FIXED: Map payment status correctly
    let paymentStatus = "pending"; // Default
    if (payment?.status === "created") {
      paymentStatus = "pending"; // Map "created" to "pending"
    } else if (["pending", "paid", "failed"].includes(payment?.status)) {
      paymentStatus = payment.status; // Valid enum values
    }

    // ✅ FIXED: Create order with schema-compliant structure
    const orderData = {
      userId: customerId, // ✅ Schema uses userId, not customerId
      items: items.map(item => ({
        bookId: item.bookId || item._id,
        qty: Number(item.qty) || 1,
        unitPrice: Number(item.price) || 0 // ✅ Required unitPrice field
      })),
      amount: amount || totals?.grandTotal || 0,
      taxAmount: totals?.taxAmount || 0,
      shippingAmount: totals?.shippingAmount || 0,
      
      // ✅ FIXED: Payment object with correct enum values
      payment: {
        provider: payment?.provider || "razorpay",
        mode: "full", // Default mode
        status: paymentStatus, // ✅ Valid enum: ["pending", "paid", "failed"]
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
      
      // ✅ FIXED: Shipping structure
      shipping: {
        name: customer?.name || "",
        phone: customer?.phone || "",
        email: customer?.email || "",
        address: shipping?.address1 || "",
        city: shipping?.city || "",
        state: shipping?.state || "",
        pincode: shipping?.postalCode || "",
        country: shipping?.country || "India",
        
        // Initialize shipping provider data
        provider: null,
        bd: {
          codAmount: 0,
          logs: []
        }
      },
      
      status: "pending", // ✅ Valid enum: ["pending", "paid", "shipped", "delivered", "refunded"]
      transactions: []
    };

    const order = new Order(orderData);
    
    // ✅ Apply payment mode logic from schema methods
    if (payment?.method === "half_online_half_cod") {
      order.applyPaymentMode("half");
    } else {
      order.applyPaymentMode("full");
    }
    
    await order.save();
    
    console.log('✅ Order created:', order._id);
    
    // ✅ Return in the format your frontend expects
    res.json({
      ok: true,
      order,
      orderId: order._id,
      _id: order._id  // Fallback for compatibility
    });
    
  } catch (e) {
    console.error("❌ Create order error:", e);
    next(e);
  }
}

export async function listOrders(req, res, next) {
  try {
    const { q = "", status = "", page = 1, limit = 20 } = req.query;
    
    // Build filter object
    let filter = {};
    
    if (q) {
      const searchRegex = new RegExp(q, 'i');
      filter.$or = [
        { '_id': { $regex: searchRegex } },
        { 'items.title': { $regex: searchRegex } }
      ];
    }
    
    if (status) {
      filter.status = status;
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Get orders with customer details
    const orders = await Order.find(filter)
      .populate('userId', 'name email phone') // ✅ Fixed: userId not customerId
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count for pagination
    const total = await Order.countDocuments(filter);
    
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
    console.error("❌ List orders error:", e);
    next(e);
  }
}

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
