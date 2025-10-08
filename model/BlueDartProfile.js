import mongoose from 'mongoose';

const BlueDartProfileSchema = new mongoose.Schema({
  label: { type: String, required: true },
  clientName: { type: String, required: true },
  shippingKey: { type: String, required: true },
  trackingKey: { type: String, required: true },
  isDefault: { type: Boolean, default: false },
  defaults: {
    weight: { type: Number, default: 0.5 },
    length: { type: Number, default: 20 },
    breadth: { type: Number, default: 15 },
    height: { type: Number, default: 3 }
  }
}, { timestamps: true });

export default mongoose.model('BlueDartProfile', BlueDartProfileSchema);
