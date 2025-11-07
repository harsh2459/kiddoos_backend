import mongoose from 'mongoose';

const BlueDartProfileSchema = new mongoose.Schema({
  label: {
    type: String,
    required: true,
    description: 'Profile name (e.g., "Main Store", "Branch 1")'
  },
  
  clientName: {
    type: String,
    required: true,
    description: 'Your customer code in Blue Dart system'
  },
  
  shippingKey: {
    type: String,
    required: true,
    description: 'License key for waybill/shipping operations'
  },
  
  trackingKey: {
    type: String,
    description: 'License key for tracking (if different from shipping)'
  },

  isDefault: {
    type: Boolean,
    default: false,
    description: 'Use this profile when none specified'
  },

  isActive: {
    type: Boolean,
    default: true,
    description: 'Whether this profile is active'
  },

  // Shipper/Consigner details (your business)
  consigner: {
    name: String,
    address: String,
    address2: String,
    address3: String,
    city: String,
    state: String,
    pincode: String,
    phone: String,
    mobile: String,
    email: String,
    customerCode: String
  },

  // Default package settings
  defaults: {
    weight: {
      type: Number,
      default: 0.5,
      description: 'Default weight in kg'
    },
    length: {
      type: Number,
      default: 20,
      description: 'Default length in cm'
    },
    breadth: {
      type: Number,
      default: 15,
      description: 'Default breadth in cm'
    },
    height: {
      type: Number,
      default: 3,
      description: 'Default height in cm'
    }
  },

  createdAt: {
    type: Date,
    default: Date.now
  },
  
  updatedAt: {
    type: Date,
    default: Date.now
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
