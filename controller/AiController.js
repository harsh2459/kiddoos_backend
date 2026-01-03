import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Setting from "../model/Setting.js";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- HELPER: Handle both Remote URLs and Local Files ---
async function urlToGenerativePart(urlOrPath, mimeType) {
  const cleanPath = String(urlOrPath).trim();

  // 1. Remote URL (Cloudinary)
  if (cleanPath.startsWith('http://') || cleanPath.startsWith('https://')) {
    try {
      console.log(`🌐 Fetching remote image: ${cleanPath}`);
      const response = await fetch(cleanPath);
      if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
      const arrayBuffer = await response.arrayBuffer();
      return { inlineData: { data: Buffer.from(arrayBuffer).toString("base64"), mimeType } };
    } catch (error) {
      console.error(`❌ Error fetching image ${cleanPath}:`, error.message);
      return null;
    }
  } 
  
  // 2. Local File
  else {
    try {
      const relativePath = cleanPath.startsWith('/') ? cleanPath.slice(1) : cleanPath;
      const absolutePath = path.join(__dirname, '..', 'public', relativePath);
      if (!fs.existsSync(absolutePath)) {
        console.error(`❌ File not found locally: ${absolutePath}`);
        return null;
      }
      return { inlineData: { data: fs.readFileSync(absolutePath).toString("base64"), mimeType } };
    } catch (e) {
      console.error("❌ Local file error:", e.message);
      return null;
    }
  }
}

// --- HELPER: JSON Extractor --- 
function cleanAndParseJSON(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    let clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
    try {
      return JSON.parse(clean);
    } catch (e2) {
      const firstOpen = clean.indexOf('{');
      const lastClose = clean.lastIndexOf('}');
      if (firstOpen !== -1 && lastClose !== -1) {
        return JSON.parse(clean.substring(firstOpen, lastClose + 1));   
      }
      throw new Error("Could not extract valid JSON from response");
    }
  }
}

// --- HELPER: Get Settings ---
async function getAiSettings() {
  const [configDoc, promptDoc] = await Promise.all([
    Setting.findOne({ key: "ai_config" }),
    Setting.findOne({ key: "ai_prompt" })
  ]);

  const config = configDoc?.value || { 
    provider: "gemini", 
    modelName: "gemini-1.5-flash", 
    keys: [] 
  };

  const prompt = promptDoc?.value || "Analyze this book and return JSON.";

  return { config, prompt };
}

// --- MAIN ANALYZE FUNCTION ---
export const analyzeBook = async (req, res) => {
  try {
    const { images } = req.body; 
    
    if (!images || !images.length) {
      return res.status(400).json({ ok: false, error: "No images provided" });
    }

    console.log("🤖 Starting AI Analysis...");

    // 1. Load Settings
    const { config, prompt } = await getAiSettings();
    // Filter only keys that are NOT exhausted
    const activeKeys = (config.keys || []).filter(k => !k.isExhausted);

    if (activeKeys.length === 0) {
      return res.status(503).json({ ok: false, error: "No active API keys available. Please add a valid key in Settings." });
    }

    // 2. Prepare Images
    const imagePartsPromise = images.map(img => urlToGenerativePart(img, "image/jpeg"));
    const imagePartsRaw = await Promise.all(imagePartsPromise);
    const imageParts = imagePartsRaw.filter(part => part !== null);

    if (imageParts.length === 0) {
      return res.status(400).json({ ok: false, error: "Could not process any images (fetch failed)." });
    }

    let result = null;
    let lastError = null;

    // 3. 🔄 SMART KEY ROTATION LOOP
    // This loop tries Key 1. If it fails, it marks it as exhausted and tries Key 2 immediately.
    keyLoop: for (const keyObj of activeKeys) {
      let attempts = 0;
      const MAX_RETRIES = 2; // Retries per key before switching

      while (attempts < MAX_RETRIES) {
        attempts++;
        try {
          console.log(`🚀 Attempt ${attempts} with Key: ${keyObj.label || '...'} | Model: ${config.modelName}`);
          
          const genAI = new GoogleGenerativeAI(keyObj.key);
          const model = genAI.getGenerativeModel({ 
              model: config.modelName,
              generationConfig: { responseMimeType: "application/json" }
          });

          const response = await model.generateContent([prompt, ...imageParts]);
          const text = response.response.text();
          
          result = cleanAndParseJSON(text);
          console.log("✅ AI Analysis Successful!");
          break keyLoop; // SUCCESS! Break out of ALL loops

        } catch (error) {
          console.error(`❌ Key ${keyObj.label} Error:`, error.message);
          lastError = error;

          // --- 🔍 DETECT FAILURE TYPE ---
          
          // 1. Quota/Rate Limit Errors (429)
          const isQuota = error.message.includes("429") || error.message.includes("quota") || error.message.includes("exhausted");
          
          // 2. Access/Model Errors (404, 403, 400)
          // If a key doesn't have access to "Pro", it often returns 404 or 403
          const isAccess = error.message.includes("404") || error.message.includes("403") || error.message.includes("Found") || error.message.includes("permission");

          // 3. Bad Request (Likely invalid model name for EVERY key)
          const isBadName = error.message.includes("400") && error.message.includes("model name");

          if (isBadName) {
             throw new Error(`Invalid Model Name: ${config.modelName}. Please select a valid model in Settings.`);
          }

          if (isQuota || isAccess) {
            console.log(`⚠️ Key ${keyObj.label} failed (Quota/Access). Switching to next key...`);
            
            // Mark this specific key as exhausted in DB so we don't use it again immediately
            const updatedKeys = config.keys.map(k => 
              k.key === keyObj.key ? { ...k, isExhausted: true, lastError: new Date() } : k
            );
            await Setting.findOneAndUpdate({ key: "ai_config" }, { value: { ...config, keys: updatedKeys } });
            
            break; // Break the 'attempts' loop to move to the NEXT KEY in the 'for' loop
          } 
          
          // If it's just a JSON syntax error, we retry the SAME key (continue while loop)
          if (error instanceof SyntaxError || error.message.includes("JSON")) {
             if (attempts === MAX_RETRIES) console.log("⚠️ JSON parsing failed after retries. Moving to next key just in case.");
             else continue;
          }
        }
      }
    }

    if (!result) {
        throw new Error(lastError ? lastError.message : "Failed to generate data. All keys may be exhausted.");
    }

    res.json({ ok: true, data: result });

  } catch (error) {
    console.error("AI Fatal Error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
};

// --- HELPER: Get Available Models ---
export const getAvailableModels = async (req, res) => {
  try {
    const { config } = await getAiSettings();
    const activeKey = config.keys.find(k => !k.isExhausted);

    if (!activeKey) return res.status(400).json({ ok: false, error: "No active API key found." });

    console.log(`🔍 Checking models with key: ${activeKey.key.slice(0, 8)}...`);
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${activeKey.key}`);
    const data = await response.json();

    if (data.error) throw new Error(data.error.message);

    const models = (data.models || [])
      .filter(m => m.supportedGenerationMethods?.includes("generateContent"))
      .map(m => m.name.replace("models/", ""));

    console.log("✅ Models found:", models);
    res.json({ ok: true, models });
  } catch (error) {
    console.error("❌ Failed to list models:", error.message);
    res.status(500).json({ ok: false, error: error.message });
  }
};