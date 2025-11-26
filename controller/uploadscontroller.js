// backend/controller/uploadscontroller.js
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import streamifier from "streamifier";
import dotenv from "dotenv";

// Ensure environment variables are loaded
dotenv.config();

// Configure Cloudinary with explicit values
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

// Debug: Verify config is loaded (remove after testing)
console.log("Cloudinary Config Check:", {
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME ? "✅ Loaded" : "❌ Missing",
  api_key: process.env.CLOUDINARY_API_KEY ? "✅ Loaded" : "❌ Missing",
  api_secret: process.env.CLOUDINARY_API_SECRET ? "✅ Loaded" : "❌ Missing"
});

// Use memory storage instead of disk storage
const storage = multer.memoryStorage();

export const upload = multer({ 
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept images only
    if (!file.mimetype.startsWith('image/')) {
      cb(new Error('Only image files are allowed!'), false);
      return;
    }
    cb(null, true);
  }
});

// Helper function to upload stream to Cloudinary
const uploadToCloudinary = (buffer, folder = "uploads") => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: folder,
        resource_type: "auto",
        transformation: [
          { quality: "auto", fetch_format: "auto" }
        ]
      },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      }
    );

    streamifier.createReadStream(buffer).pipe(uploadStream);
  });
};

export const uploadImage = async (req, res) => {
  try {
    if (!req.files || !req.files.length) {
      return res.status(400).json({ ok: false, error: "No files uploaded" });
    }

    // Upload all files to Cloudinary in parallel
    const uploadPromises = req.files.map(file => 
      uploadToCloudinary(file.buffer, "kiddos/uploads")
    );

    const results = await Promise.all(uploadPromises);

    // Map results to your existing format
    const images = results.map(result => ({
      path: result.secure_url,        // Cloudinary URL
      previewUrl: result.secure_url,  // Same as path
      publicId: result.public_id,     // For future deletions
      format: result.format,
      width: result.width,
      height: result.height,
    }));

    return res.json({ ok: true, images });

  } catch (error) {
    console.error("Cloudinary upload error:", error);
    return res.status(500).json({ 
      ok: false, 
      error: "Failed to upload images to Cloudinary" 
    });
  }
};

// Optional: Add a delete function for cleanup
export const deleteImage = async (req, res) => {
  try {
    const { publicId } = req.body;
    
    if (!publicId) {
      return res.status(400).json({ ok: false, error: "Public ID required" });
    }

    const result = await cloudinary.uploader.destroy(publicId);
    
    return res.json({ 
      ok: true, 
      result,
      message: result.result === 'ok' ? 'Image deleted' : 'Image not found'
    });

  } catch (error) {
    console.error("Cloudinary delete error:", error);
    return res.status(500).json({ 
      ok: false, 
      error: "Failed to delete image" 
    });
  }
};