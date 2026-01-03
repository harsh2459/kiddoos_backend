// backend/_services/cloudinary-uploader.js
import { v2 as cloudinary } from 'cloudinary';
import stream from 'stream';

// Configure Cloudinary
cloudinary.config({
  cloud_name: 'dphe8hssk',
  api_key: '658981832913891',
  api_secret: 'P49FZYc6BDPoBhbO6RLo2wVibpk' 
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
        resource_type: 'auto',  // 👈 CHANGE THIS from 'raw' to 'auto'
        folder: folder,
        public_id: filename,
        format: 'pdf',          // 👈 ADD THIS to force PDF format
        overwrite: true
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    const bufferStream = new stream.PassThrough();
    bufferStream.end(buffer);
    bufferStream.pipe(uploadStream);
  });
};

export default {
  uploadBuffer
};