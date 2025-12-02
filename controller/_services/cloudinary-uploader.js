// backend/_services/cloudinary-uploader.js
import { v2 as cloudinary } from 'cloudinary';
import stream from 'stream';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

/**
 * Uploads a file buffer (PDF) directly to Cloudinary
 * @param {Buffer} buffer - The raw PDF data
 * @param {string} filename - The desired filename (e.g., awb number)
 * @param {string} folder - Folder in Cloudinary (default: 'shipping-labels')
 */
export const uploadBuffer = (buffer, filename, folder = 'shipping-labels') => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'raw', // 'raw' is required for non-image files like PDFs
        folder: folder,
        public_id: filename,
        format: 'pdf',
        overwrite: true
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    // Create a read stream from the buffer and pipe it to Cloudinary
    const bufferStream = new stream.PassThrough();
    bufferStream.end(buffer);
    bufferStream.pipe(uploadStream);
  });
};

export default {
  uploadBuffer
};