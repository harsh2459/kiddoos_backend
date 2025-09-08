import Order from "../model/Order.js";

export const createOrder = async (req, res) => {
  const { items, email, phone, shippingAddress } = req.body;
  if (!items?.length) return res.status(400).json({ ok:false, error:"Items required" });
  const amount = items.reduce((sum, i) => sum + (i.unitPrice * i.qty), 0);
  const order = await Order.create({
    items, email, phone, shippingAddress,
    amount, status: "pending", payment: { status: "pending" }
  });
  res.status(201).json({ ok:true, order });
};

export const listOrders = async (req, res) => {
  const orders = await Order.find().sort("-createdAt");
  res.json({ ok:true, orders });
};

export const updateOrderStatus = async (req, res) => {
  const { status } = req.body;
  const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new:true });
  if (!order) return res.status(404).json({ ok:false, error:"Not found" });
  res.json({ ok:true, order });
};
