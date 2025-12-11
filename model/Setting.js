import mongoose from "mongoose";

const PopupConfigSchema = new mongoose.Schema({
  // Basic Info
  title: { type: String, required: true },
  description: String,

  // Design Type
  designType: {
    type: String,
    enum: ['custom', 'image'],
    default: 'custom'
  },

  // For Image Design
  imageUrl: String, // Full popup design as image

  // For Custom Design
  customDesign: {
    layout: {
      type: String,
      enum: ['left-right', 'top-bottom', 'center', 'minimal'],
      default: 'left-right'
    },
    backgroundColor: { type: String, default: '#ffffff' },
    textColor: { type: String, default: '#000000' },
    accentColor: { type: String, default: '#4F46E5' },
    borderRadius: { type: String, default: '12px' },
    padding: { type: String, default: '24px' },
    maxWidth: { type: String, default: '600px' },
    fontFamily: { type: String, default: 'system-ui' },

    // Title Styles
    titleFontSize: { type: String, default: '24px' },
    titleFontWeight: { type: String, default: '700' },
    titleColor: String, // Override textColor if needed

    // Description Styles
    descriptionFontSize: { type: String, default: '16px' },
    descriptionColor: String,

    // CTA Button Styles
    ctaBackgroundColor: String, // Override accentColor if needed
    ctaTextColor: { type: String, default: '#ffffff' },
    ctaFontSize: { type: String, default: '16px' },
    ctaFontWeight: { type: String, default: '600' },
    ctaBorderRadius: { type: String, default: '8px' },
    ctaPadding: { type: String, default: '12px 24px' },

    // Image/Product Display
    showProductImage: { type: Boolean, default: true },
    imagePosition: {
      type: String,
      enum: ['left', 'right', 'top', 'bottom'],
      default: 'left'
    },
    imageSize: { type: String, default: '50%' },

    // Overlay
    overlayColor: { type: String, default: 'rgba(0, 0, 0, 0.5)' },
    overlayBlur: { type: String, default: '0px' },

    // Animation
    animationType: {
      type: String,
      enum: ['fade', 'slide-up', 'slide-down', 'zoom', 'bounce'],
      default: 'fade'
    },
    animationDuration: { type: String, default: '300ms' }
  },

  // Product Reference
  productId: { type: mongoose.Types.ObjectId, ref: 'Book' },
  discountPercentage: { type: Number, default: 0, min: 0, max: 100 },

  // CTA
  ctaText: { type: String, default: 'Shop Now' },
  ctaLink: String,

  // Targeting
  targetPages: [{ type: String }],
  showToNewVisitors: { type: Boolean, default: true },
  showToReturningVisitors: { type: Boolean, default: true },

  // Trigger Settings
  triggerType: {
    type: String,
    enum: ['time', 'scroll', 'exit', 'immediate'],
    default: 'time'
  },
  triggerValue: { type: Number, default: 5 },

  // Scheduling
  isActive: { type: Boolean, default: false },
  startDate: Date,
  endDate: Date,

  // Frequency Control
  showOncePerSession: { type: Boolean, default: true },
  showOncePerDay: { type: Boolean, default: false },
  showMaxTimes: { type: Number, default: 0 }, // 0 = unlimited

  // Analytics
  impressions: { type: Number, default: 0 },
  clicks: { type: Number, default: 0 },
  conversions: { type: Number, default: 0 },
  dismissals: { type: Number, default: 0 }



}, { _id: true, timestamps: true });

const SettingSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  value: mongoose.Schema.Types.Mixed,
}, { timestamps: true });

export default mongoose.model("Setting", SettingSchema);