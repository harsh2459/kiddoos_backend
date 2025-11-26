import Setting from "../model/Setting.js";
import { getBaseFromReq, toAbsolute, sanitizePathsToRelative } from "../utils/url.js";
import { PUBLIC_BASES } from "../app.js";
import Book from "../model/Book.js";

async function getKey(key, fallback = {}) {
  const doc = await Setting.findOne({ key });
  return doc?.value ?? fallback;
}

function isAbsoluteUrl(url) {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://');
}

function toAbsoluteIfNeeded(url, base) {
  if (!url) return "";
  if (isAbsoluteUrl(url)) return url;
  return toAbsolute(url, base);
}

// PUBLIC
export const getPublicSettings = async (req, res) => {
  const site = await getKey("site", { title: "Catalogue", logoUrl: "", faviconUrl: "" });
  const theme = await getKey("theme", {});
  const homepage = await getKey("homepage", { blocks: [] });
  const payments = await getKey("payments", { providers: [] });
  const popup = await getKey("popup", { enabled: false, configs: [] });
  const visibility = await getKey("visibility", {
    publicNav: ["catalog", "theme", "admin", "cart"],
    pages: { catalog: { public: true }, theme: { public: true }, adminLogin: { public: true } }
  });

  const base = getBaseFromReq(req);
  const siteOut = {
    ...site,
    logoUrl: toAbsoluteIfNeeded(site.logoUrl, base),
    faviconUrl: toAbsoluteIfNeeded(site.faviconUrl, base),
  };

  const safePayments = {
    providers: (payments.providers || []).map(p => ({
      id: p.id,
      name: p.name,
      enabled: !!p.enabled
    }))
  };

  res.json({
    ok: true,
    site: siteOut,
    theme,
    homepage,
    payments: safePayments,
    visibility,
    popup: { enabled: popup.enabled }
  });
};

export const getAdminSettings = async (req, res) => {
  const site = await getKey("site", {});
  const theme = await getKey("theme", {});
  const homepage = await getKey("homepage", { blocks: [] });
  const payments = await getKey("payments", { providers: [] });
  const visibility = await getKey("visibility", {
    publicNav: ["catalog", "theme", "admin", "cart"],
    pages: {}
  });
  const popup = await getKey("popup", { enabled: false, configs: [] });

  const base = getBaseFromReq(req);
  const siteOut = {
    ...site,
    logoUrl: toAbsoluteIfNeeded(site.logoUrl, base),
    faviconUrl: toAbsoluteIfNeeded(site.faviconUrl, base),
  };

  res.json({ ok: true, site: siteOut, theme, homepage, payments, visibility, popup });
};

export const updateSiteSettings = async (req, res) => {
  const input = { ...(req.body || {}) };

  const sanitized = {
    ...input,
    logoUrl: isAbsoluteUrl(input.logoUrl)
      ? input.logoUrl
      : sanitizePathsToRelative({ logoUrl: input.logoUrl }, PUBLIC_BASES).logoUrl,
    faviconUrl: isAbsoluteUrl(input.faviconUrl)
      ? input.faviconUrl
      : sanitizePathsToRelative({ faviconUrl: input.faviconUrl }, PUBLIC_BASES).faviconUrl,
  };

  const doc = await Setting.findOneAndUpdate(
    { key: "site" },
    { value: sanitized },
    { upsert: true, new: true }
  );

  const base = getBaseFromReq(req);
  const siteAbs = {
    ...doc.value,
    logoUrl: toAbsoluteIfNeeded(doc.value.logoUrl, base),
    faviconUrl: toAbsoluteIfNeeded(doc.value.faviconUrl, base),
  };

  res.json({ ok: true, site: siteAbs });
};

export const updateThemeSettings = async (req, res) => {
  const doc = await Setting.findOneAndUpdate(
    { key: "theme" },
    { value: req.body },
    { upsert: true, new: true }
  );
  res.json({ ok: true, theme: doc.value });
};

export const updateHomepage = async (req, res) => {
  const { blocks } = req.body;
  const doc = await Setting.findOneAndUpdate(
    { key: "homepage" },
    { value: { blocks } },
    { upsert: true, new: true }
  );
  res.json({ ok: true, homepage: doc.value });
};

export const upsertPayments = async (req, res) => {
  const doc = await Setting.findOneAndUpdate(
    { key: "payments" },
    { value: req.body },
    { upsert: true, new: true }
  );
  res.json({ ok: true, payments: doc.value });
};

export const getPopupSettings = async (req, res) => {
  try {
    const popup = await getKey("popup", {
      enabled: false,
      configs: []
    });
    
    const base = getBaseFromReq(req);
    
    // Populate product details and convert image URLs
    const populatedConfigs = await Promise.all(
      (popup.configs || []).map(async (config) => {
        const configOut = { ...config };
        
        // Convert image URL to absolute if needed
        if (config.imageUrl) {
          configOut.imageUrl = toAbsoluteIfNeeded(config.imageUrl, base);
        }
        
        // Populate product
        if (config.productId) {
          try {
            const product = await Book.findById(config.productId)
              .select('title slug authors price mrp discountPct assets.coverUrl')
              .lean();
            
            if (product) {
              // Convert product images to absolute
              if (product.assets?.coverUrl) {
                product.assets.coverUrl = product.assets.coverUrl.map(url => 
                  toAbsoluteIfNeeded(url, base)
                );
              }
              configOut.product = product;
            }
          } catch (err) {
            console.error('Book not found:', config.productId);
          }
        }
        
        return configOut;
      })
    );
    
    return res.json({ 
      ok: true, 
      popup: { ...popup, configs: populatedConfigs } 
    });
  } catch (error) {
    console.error('getPopupSettings error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Get active popup for public visitors
export const getActivePopup = async (req, res) => {
  try {
    const { page = 'all', userType = 'new' } = req.query;
    
    console.log('🔍 Backend: getActivePopup called with:', { page, userType });
    
    const popup = await getKey("popup", { enabled: false, configs: [] });
    
    console.log('📊 Backend: Popup settings from DB:', { 
      enabled: popup.enabled, 
      configsCount: popup.configs?.length || 0 
    });
    
    if (!popup.enabled) {
      console.log('🚫 Backend: Popups are disabled globally');
      return res.json({ ok: true, popup: null });
    }
    
    const now = new Date();
    console.log('⏰ Backend: Current time:', now);
    
    // Find matching active popup
    const matchedConfig = (popup.configs || []).find(config => {
      const isActive = config.isActive;
      const startValid = !config.startDate || new Date(config.startDate) <= now;
      const endValid = !config.endDate || new Date(config.endDate) >= now;
      const pageValid = config.targetPages.includes('all') || config.targetPages.includes(page);
      const userValid = (userType === 'new' && config.showToNewVisitors) || 
                       (userType === 'returning' && config.showToReturningVisitors);
      
      console.log(`🔍 Backend: Checking config "${config.title}":`, {
        isActive,
        startValid,
        endValid,
        pageValid,
        userValid,
        targetPages: config.targetPages,
        showToNew: config.showToNewVisitors,
        showToReturning: config.showToReturningVisitors
      });
      
      return isActive && startValid && endValid && pageValid && userValid;
    });
    
    if (!matchedConfig) {
      console.log('🚫 Backend: No matching active popup found');
      return res.json({ ok: true, popup: null });
    }
    
    console.log('✅ Backend: Found matching popup:', matchedConfig.title);
    
    const base = getBaseFromReq(req);
    const configOut = { ...matchedConfig };
    
    // Convert image URL to absolute
    if (matchedConfig.imageUrl) {
      configOut.imageUrl = toAbsoluteIfNeeded(matchedConfig.imageUrl, base);
    }
    
    // For image design, we don't need product details
    if (matchedConfig.designType === 'image') {
      console.log('🖼️ Backend: Returning image-based popup');
      return res.json({ ok: true, popup: configOut });
    }
    
    // For custom design, populate product details
    if (matchedConfig.productId) {
      try {
        const product = await Book.findById(matchedConfig.productId)
          .select('title slug price mrp discountPct assets.coverUrl')
          .lean();
        
        if (product) {
          // Convert product images to absolute
          if (product.assets?.coverUrl) {
            product.assets.coverUrl = product.assets.coverUrl.map(url => 
              toAbsoluteIfNeeded(url, base)
            );
          }
          configOut.product = product;
          console.log('📚 Backend: Product populated:', product.title);
        }
      } catch (err) {
        console.error('❌ Backend: Book not found:', matchedConfig.productId);
      }
    }
    
    if (!configOut.product && matchedConfig.designType === 'custom') {
      console.log('🚫 Backend: Custom design popup missing product');
      return res.json({ ok: true, popup: null });
    }
    
    console.log('🎉 Backend: Returning popup data');
    res.json({ ok: true, popup: configOut });
    
  } catch (error) {
    console.error('❌ Backend: getActivePopup error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Update popup settings (admin only)
export const updatePopupSettings = async (req, res) => {
  try {
    const { enabled, configs } = req.body;
    
    // Sanitize image URLs in configs
    const sanitizedConfigs = configs.map(config => {
      const sanitized = { ...config };
      
      if (config.imageUrl && !isAbsoluteUrl(config.imageUrl)) {
        sanitized.imageUrl = sanitizePathsToRelative(
          { imageUrl: config.imageUrl }, 
          PUBLIC_BASES
        ).imageUrl;
      }
      
      // Remove temporary product data
      delete sanitized.product;
      
      return sanitized;
    });
    
    const doc = await Setting.findOneAndUpdate(
      { key: "popup" },
      { 
        value: {
          enabled: !!enabled,
          configs: sanitizedConfigs
        }
      },
      { upsert: true, new: true }
    );
    
    res.json({ ok: true, popup: doc.value });
  } catch (error) {
    console.error('updatePopupSettings error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
};

// Track popup analytics
export const trackPopup = async (req, res) => {
  try {
    const { configId, action } = req.body;
    
    const popup = await getKey("popup", { enabled: false, configs: [] });
    const configIndex = popup.configs.findIndex(c => c._id === configId);
    
    if (configIndex === -1) {
      return res.status(404).json({ ok: false, error: "Config not found" });
    }
    
    // Update analytics
    const fieldMap = {
      impression: 'impressions',
      click: 'clicks',
      conversion: 'conversions',
      dismiss: 'dismissals'
    };
    
    const field = fieldMap[action];
    if (!field) {
      return res.status(400).json({ ok: false, error: "Invalid action" });
    }
    
    popup.configs[configIndex][field] = (popup.configs[configIndex][field] || 0) + 1;
    
    await Setting.findOneAndUpdate(
      { key: "popup" },
      { value: popup },
      { upsert: true }
    );
    
    res.json({ ok: true });
  } catch (error) {
    console.error('trackPopup error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
};