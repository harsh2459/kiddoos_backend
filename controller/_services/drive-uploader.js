// backend/_services/drive-uploader.js
import { google } from 'googleapis';
import stream from 'stream';
import path from 'path';

// Path to your Google Service Account Key
const KEYFILEPATH = path.join(process.cwd(), 'service-account.json');
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

// Initialize Auth
const auth = new google.auth.GoogleAuth({
  keyFile: KEYFILEPATH,
  scopes: SCOPES,
});

const drive = google.drive({ version: 'v3', auth });

/**
 * Uploads a Buffer (PDF) to Google Drive
 */
export const uploadBuffer = async (buffer, fileName, folderId) => {
  try {
    const bufferStream = new stream.PassThrough();
    bufferStream.end(buffer);

    const fileMetadata = {
      name: fileName,
      parents: folderId ? [folderId] : [], // Upload to specific folder if provided
    };

    const media = {
      mimeType: 'application/pdf',
      body: bufferStream,
    };

    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, webViewLink, webContentLink',
    });

    // Make file public/viewable (Optional - helpful for dashboard links)
    await drive.permissions.create({
      fileId: response.data.id,
      requestBody: { role: 'reader', type: 'anyone' },
    });

    console.log(`✅ [Drive] Uploaded: ${fileName}`);
    return {
      success: true,
      url: response.data.webViewLink,
      fileId: response.data.id
    };

  } catch (error) {
    console.error('❌ [Drive] Upload Failed:', error.message);
    throw error; // Throw error so we can catch it and switch to Cloudinary
  }
};