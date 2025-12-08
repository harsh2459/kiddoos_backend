import Razorpay from "razorpay";
import crypto from "crypto";
import Order from "../model/Order.js";
import Payment from "../model/Payment.js";
import Setting from "../model/Setting.js";

async function getRazorpayCfg() {
  const setting = await Setting.findOne({ key: "payments" }).lean();
  if (!setting?.value) throw new Error("No payments config found");
  const rp = (setting.value.providers || []).find(p => p.id === "razorpay" && p.enabled);
  if (!rp) throw new Error("Razorpay config missing or disabled");
  const { keyId, keySecret } = rp.config || {};
  if (!keyId || !keySecret) throw new Error("Razorpay keyId/keySecret missing");      
  return { keyId, keySecret };
}

export const createRazorpayOrder = async (req, res) => {
  try {

    const { amountInRupees, orderId, paymentType } = req.body;

    // Debug logs
    console.log("===================");
    console.log("📦 Payment Request:");
    console.log("amountInRupees:", amountInRupees);
    console.log("paymentType:", paymentType);
    console.log("===================");

    if (!amountInRupees || !orderId || !paymentType) {
      return res.status(400).json({ ok: false, error: "Missing required fields" });
    }

    const { keyId, keySecret } = await getRazorpayCfg();
    const fullPaise = Math.floor(Number(amountInRupees) * 100);
    let amountToCharge = fullPaise;

    console.log("💰 Before check:");
    console.log("fullPaise:", fullPaise);

    // Check for half payment
    if (paymentType === "half_online_half_cod" || paymentType === "half_cod_half_online") {
      amountToCharge = Math.floor(fullPaise / 2);
      console.log("✅ DIVIDED BY 2!");
      console.log("   New amount:", amountToCharge, "paise (₹" + (amountToCharge / 100) + ")");
    } else {
      console.log("❌ NOT DIVIDED - using full amount");
    }

    const shortId = String(orderId).slice(-8);
    const ts = Date.now().toString().slice(-6);
    const receipt = `rcpt_${shortId}_${ts}`;

    const rzp = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const rpOrder = await rzp.orders.create({
      amount: amountToCharge,
      currency: "INR",
      receipt
    });

    console.log("🎯 Razorpay Order Created:");
    console.log("   amount:", rpOrder.amount, "paise (₹" + (rpOrder.amount / 100) + ")");
    console.log("===================");

    // ✅ FIXED: Calculate pendingAmount correctly (in paise, not rupees)
    const pendingAmountPaise = (paymentType === "half_online_half_cod" || paymentType === "half_cod_half_online")
      ? (fullPaise - amountToCharge)
      : 0;

    const payment = await Payment.create({
      orderId,
      paymentType,
      provider: "razorpay",
      providerOrderId: rpOrder.id,
      status: "created",
      paidAmount: 0,
      pendingAmount: pendingAmountPaise / 100, // Convert to rupees for storage
      currency: rpOrder.currency,
      rawResponse: rpOrder
    });

    return res.json({
      ok: true,
      order: rpOrder,
      key: keyId,
      paymentId: payment._id
    });

  } catch (e) {
    console.error("createRazorpayOrder error:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
};

export const verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, paymentId } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !paymentId) {
      return res.status(400).json({ ok: false, error: "Missing verification data" });
    }

    const payment = await Payment.findById(paymentId);
    if (!payment) return res.status(404).json({ ok: false, error: "Payment not found" });

    const { keySecret } = await getRazorpayCfg();
    const generated_signature = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generated_signature !== razorpay_signature) {
      return res.status(400).json({ ok: false, error: "Invalid signature" });
    }

    // ✅ 1. UPDATE PAYMENT MODEL
    payment.providerPaymentId = razorpay_payment_id;
    payment.paidAt = new Date();
    payment.verifiedAt = new Date();
    payment.status = 'partially_paid'; // Default for half payment

    // Fix Math Logic:
    // If half payment, the 'pendingAmount' stored initially was the HALF amount (e.g., 219.5)
    // We shouldn't divide by 2 again. We just move pending -> paid.
    
    if (payment.paymentType === 'half_online_half_cod' || payment.paymentType === 'half_cod_half_online') {
       // The amount we tried to charge (pendingAmount) is now PAID.
       // We assume the pendingAmount stored in DB was the half amount.
       const amountJustPaid = payment.pendingAmount; 
       
       payment.paidAmount = amountJustPaid; 
       payment.pendingAmount = 0; // The *online* part is no longer pending
       payment.status = 'partially_paid';
    } else {
       // Full payment
       const total = payment.pendingAmount + payment.paidAmount;
       payment.paidAmount = total;
       payment.pendingAmount = 0;
       payment.status = 'paid';
    }
    
    await payment.save();

    // ✅ 2. SYNC ORDER MODEL (CRITICAL FIX)
    // We must update the Order to reflect the mode and amount from the Payment
    const order = await Order.findById(payment.orderId);
    
    if (order) {
      // Force update the payment mode if it was wrong
      if (payment.paymentType === 'half_online_half_cod' || payment.paymentType === 'half_cod_half_online') {
        order.payment.mode = 'half';
        order.payment.paymentType = 'half_online_half_cod';
        order.payment.codSettlementStatus = 'pending';
        
        // Sync the amounts
        order.payment.paidAmount = payment.paidAmount;
        
        // Calculate remaining due
        // (Total Order Amount - What was just paid)
        order.payment.dueOnDeliveryAmount = order.amount - payment.paidAmount;
        
        order.payment.status = 'partially_paid';
        order.status = 'confirmed'; // Order is confirmed because they paid the booking amount
        
        // Update shipping info for BlueDart (Product Code D)
        if(!order.shipping) order.shipping = {};
        if(!order.shipping.bd) order.shipping.bd = {};
        order.shipping.bd.productCode = 'D';
        order.shipping.bd.codAmount = order.payment.dueOnDeliveryAmount;

      } else {
        // Full Payment
        order.payment.mode = 'full';
        order.payment.paymentType = 'full_online';
        order.payment.paidAmount = order.amount;
        order.payment.dueOnDeliveryAmount = 0;
        order.payment.status = 'paid';
        order.status = 'confirmed';

        // Update shipping info for BlueDart (Product Code A)
        if(!order.shipping) order.shipping = {};
        if(!order.shipping.bd) order.shipping.bd = {};
        order.shipping.bd.productCode = 'E';
        order.shipping.bd.codAmount = 0;
      }

      // Save Razorpay details to Order
      order.payment.paymentId = razorpay_payment_id;
      order.payment.orderId = razorpay_order_id;
      order.payment.signature = razorpay_signature;

      await order.save();
    }

    res.json({ ok: true, verified: true, payment, order });
  } catch (e) {
    console.error("verifyPayment error:", e);
    res.status(500).json({ ok: false, error: e.message });
  }
};  

export const razorpayWebhook = async (req, res) => {
  try {
    const signature = req.headers["x-razorpay-signature"];
    if (!signature) return res.status(400).send("Missing signature");

    const { keySecret } = await getRazorpayCfg();
    const expected = crypto.createHmac("sha256", keySecret)
      .update(JSON.stringify(req.body))
      .digest("hex");

    if (signature !== expected) {
      console.error("Invalid webhook signature");
      return res.status(400).send("Invalid signature");
    }

    const event = req.body;
    if (event.event === "payment.captured") {
      const paymentEntity = event.payload.payment?.entity;
      if (paymentEntity?.order_id && paymentEntity?.id) {
        await Payment.findOneAndUpdate(
          { providerOrderId: paymentEntity.order_id },
          {
            $set: {
              status: "captured",
              providerPaymentId: paymentEntity.id,
              paidAt: new Date()
            }
          }
        );
      }
    }
    res.json({ ok: true });
  } catch (error) {
    console.error("Webhook processing error:", error);
    res.status(500).json({ ok: false, error: "Processing failed" });
  }
};

//
export const processRefund = async (req, res) => {
  try {
    const { orderId, amount, reason } = req.body;
    console.log("💰 [1] Refund Request Received:", { orderId, amount });

    // 1. Fetch Order
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ ok: false, error: 'Order not found' });

    // 2. Fetch Payment Record
    const paymentRecord = await Payment.findOne({ orderId: orderId });
    
    if (!paymentRecord) {
      return res.status(404).json({
        ok: false,
        error: 'Payment record not found for this order'
      });
    }

    console.log('💳 [2] Payment Record Found:', {
      payment_id: paymentRecord._id,
      providerOrderId: paymentRecord.providerOrderId,
      providerPaymentId: paymentRecord.providerPaymentId,
      status: paymentRecord.status,
      paidAmount: paymentRecord.paidAmount
    });

    // 3. Get Payment ID
    const paymentId = String(paymentRecord.providerPaymentId || "").trim();
    
    if (!paymentId) {
      return res.status(400).json({
        ok: false,
        error: 'No Razorpay payment ID found'
      });
    }

    if (!paymentId.startsWith("pay_")) {
      return res.status(400).json({
        ok: false,
        error: `Invalid Payment ID: ${paymentId}`
      });
    }

    console.log('✅ [3] Payment ID Validated:', { paymentId });

    // 4. Calculate Amount
    const totalPaid = Number(paymentRecord.paidAmount) || Number(order.payment?.paidAmount) || 0;
    const existingRefunds = order.transactions?.filter(
      txn => txn.kind === 'refund' && txn.status === 'refunded'
    ) || [];
    
    const totalRefunded = existingRefunds.reduce(
      (sum, txn) => sum + (Number(txn.amount) || 0), 
      0
    );
    
    const maxRefundable = totalPaid - totalRefunded;
    const requestedAmount = amount ? Number(amount) : maxRefundable;

    console.log('📊 [4] Amount Calculation:', {
      totalPaid,
      totalRefunded,
      maxRefundable,
      requestedAmount
    });

    if (isNaN(requestedAmount) || requestedAmount <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid refund amount" });
    }

    if (requestedAmount > maxRefundable) {
      return res.status(400).json({
        ok: false,
        error: `Cannot refund ₹${requestedAmount}. Maximum refundable: ₹${maxRefundable.toFixed(2)}`
      });
    }

    // 5. Get Razorpay Config
    const { keyId, keySecret } = await getRazorpayCfg();
    const rzp = new Razorpay({ key_id: keyId, key_secret: keySecret });

    console.log('🔑 [5] Razorpay SDK initialized');
    console.log('🔍 [5.1] Using credentials:', {
      keyId: keyId.substring(0, 15) + '...',
      mode: keyId.includes('test') ? 'TEST' : 'LIVE'
    });

    // ✅ 6. VERIFY PAYMENT EXISTS ON RAZORPAY (NEW STEP!)
    console.log('🔍 [6] Fetching payment from Razorpay to verify...');
    let razorpayPayment;
    
    try {
      razorpayPayment = await rzp.payments.fetch(paymentId);
      
      console.log('✅ [6] Payment found on Razorpay:', {
        id: razorpayPayment.id,
        status: razorpayPayment.status,
        method: razorpayPayment.method,
        amount: razorpayPayment.amount,
        amount_rupees: razorpayPayment.amount / 100,
        captured: razorpayPayment.captured,
        amount_refunded: razorpayPayment.amount_refunded || 0,
        refund_status: razorpayPayment.refund_status,
        order_id: razorpayPayment.order_id
      });
    } catch (fetchError) {
      console.error('❌ [6] Payment NOT found on Razorpay:', fetchError);
      
      return res.status(400).json({
        ok: false,
        error: 'Payment not found on Razorpay',
        suggestion: 'This payment was likely created with different Razorpay credentials (test/live mismatch)',
        debug: {
          payment_id: paymentId,
          your_credentials: keyId.includes('test') ? 'test' : 'live',
          error_code: fetchError.error?.code,
          error_message: fetchError.error?.description
        }
      });
    }

    // ✅ 7. VALIDATE PAYMENT STATUS
    if (razorpayPayment.status !== 'captured') {
      console.error('❌ [7] Payment not captured. Status:', razorpayPayment.status);
      
      return res.status(400).json({
        ok: false,
        error: `Cannot refund. Payment status is "${razorpayPayment.status}". Only "captured" payments can be refunded.`,
        suggestion: razorpayPayment.status === 'authorized' 
          ? 'This payment is authorized but not captured. You need to capture it first before refunding.'
          : 'Check the payment status in Razorpay dashboard.',
        payment_status: razorpayPayment.status
      });
    }

    // Check if already refunded
    const alreadyRefundedOnRzp = razorpayPayment.amount_refunded || 0;
    const maxRefundableOnRzp = razorpayPayment.amount - alreadyRefundedOnRzp;

    console.log('💰 [7] Refund Status Check:', {
      payment_amount: razorpayPayment.amount,
      already_refunded: alreadyRefundedOnRzp,
      max_refundable: maxRefundableOnRzp,
      requested: Math.round(requestedAmount * 100)
    });

    if (maxRefundableOnRzp <= 0) {
      return res.status(400).json({
        ok: false,
        error: 'This payment has already been fully refunded on Razorpay'
      });
    }

    // 8. Prepare Clean Payload (THE FIX)
    const amountInPaise = Math.round(requestedAmount * 100);
    
    if (amountInPaise > maxRefundableOnRzp) {
      return res.status(400).json({
        ok: false,
        error: `Cannot refund ₹${requestedAmount}. Already refunded ₹${alreadyRefundedOnRzp/100} on Razorpay.`
      });
    }

    // Generate a unique receipt ID (Recommended by Razorpay)
    const shortId = String(orderId).slice(-8);
    const ts = Date.now().toString().slice(-6);
    const receiptId = `rfnd_${shortId}_${ts}`;

    // ⚠️ CRITICAL CHANGE: We REMOVED 'notes' and added 'receipt'.
    // 'notes' often causes 400 errors in refunds if not formatted perfectly.
    const refundPayload = {
      amount: amountInPaise,
      receipt: receiptId
    };

    console.log(`🚀 [8] Sending CLEAN refund to Razorpay:`, {
      payment_id: paymentId,
      payload: refundPayload
    });

    // 9. Execute Refund
    let razorpayRefund;
    try {
      razorpayRefund = await rzp.payments.refund(paymentId, refundPayload);
      
      console.log('✅ [9] Refund Successful!', {
        refund_id: razorpayRefund.id,
        status: razorpayRefund.status
      });

    } catch (err) {
      console.error("🔥 [9] Razorpay Refund Failed:", err);
      
      const errorDescription = err.error?.description || err.message;
      return res.status(400).json({ 
        ok: false, 
        error: errorDescription,
        suggestion: 'If this persists, the payment might be too old or restricted in Test Mode.'
      });
    }

    // 10. Save to Database
    // We still save the reason/notes to YOUR database, just not to Razorpay
    order.addTransaction({
      kind: 'refund',
      provider: 'razorpay',
      amount: requestedAmount,
      at: new Date(),
      paymentId: paymentId,
      reference: razorpayRefund.id,
      status: razorpayRefund.status === 'processed' ? 'refunded' : 'pending',
      meta: { 
        reason: reason, 
        notes_we_skipped_sending: { initiator: "Admin" } // Save it here instead
      }
    });

    const newTotalRefunded = totalRefunded + requestedAmount;
    
    if (newTotalRefunded >= totalPaid) {
      order.payment.status = 'refunded';
      order.status = 'refunded';
    } else {
      order.payment.status = 'partially_refunded';
    }

    await order.save();

    // Update Payment collection
    paymentRecord.status = newTotalRefunded >= totalPaid ? 'refunded' : 'partially_refunded';
    await paymentRecord.save();

    console.log('✅ [10] Database updated successfully');
    console.log('🎉 ========== REFUND COMPLETED SUCCESSFULLY ==========');

    return res.json({ 
      ok: true, 
      message: `Refund of ₹${requestedAmount} processed successfully`,
      data: {
        refund: {
          id: razorpayRefund.id,
          amount: requestedAmount,
          status: razorpayRefund.status,
          created_at: razorpayRefund.created_at
        },
        order: {
          id: order._id,
          status: order.status,
          payment_status: order.payment.status
        }
      }
    });

  } catch (error) {
    console.error("❌ System Error:", error);
    return res.status(500).json({ ok: false, error: error.message });
  }
};



/**
 * Get Refund History - NEW FUNCTION
 */
export const getRefundHistory = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ ok: false, error: 'Order not found' });
    }

    const refunds = order.transactions.filter(txn => txn.kind === 'refund');

    const totalRefunded = refunds
      .filter(r => r.status === 'refunded')
      .reduce((sum, r) => sum + r.amount, 0);

    const pendingRefunds = refunds
      .filter(r => r.status === 'pending')
      .reduce((sum, r) => sum + r.amount, 0);

    const refundSummary = {
      orderId: order._id,
      orderStatus: order.status,
      paymentStatus: order.payment.status,
      totalPaid: order.payment.paidAmount + totalRefunded,
      currentPaid: order.payment.paidAmount,
      totalRefunded,
      pendingRefunds,
      refundableAmount: order.payment.paidAmount,
      refunds: refunds.map(r => ({
        id: r._id,
        amount: r.amount,
        status: r.status,
        refundedAt: r.at,
        razorpayRefundId: r.reference,
        reason: r.meta?.reason,
        refundedBy: r.meta?.refunded_by,
        speed: r.meta?.speed,
      }))
    };

    return res.json({ ok: true, data: refundSummary });

  } catch (error) {
    console.error('❌ Get refund history error:', error);
    return res.status(500).json({ ok: false, error: 'Failed to fetch refund history' });
  }
};