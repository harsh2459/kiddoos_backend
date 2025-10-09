import mongoose from 'mongoose';

const BlueDartProfileSchema = new mongoose.Schema({
  label: { type: String, required: true },
  clientName: { type: String, required: true },
  shippingKey: { type: String, required: true },
  trackingKey: { type: String, required: true },
  isDefault: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  defaults: {
    weight: { type: Number, default: 0.5 },
    length: { type: Number, default: 20 },
    breadth: { type: Number, default: 15 },
    height: { type: Number, default: 3 }
  },
  consigner: {
    name: String,
    address: String,
    city: String,
    pincode: String,
    phone: String
  }
}, { timestamps: true });

// Ensure only one default profile
BlueDartProfileSchema.pre('save', async function(next) {
  if (this.isDefault) {
    await this.constructor.updateMany(
      { _id: { $ne: this._id } }, 
      { isDefault: false }
    );
  }
  next();
});

export default mongoose.model('BlueDartProfile', BlueDartProfileSchema);
