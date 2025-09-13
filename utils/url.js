// utils/url.js
export function getBaseFromReq(req) {
  const proto = req.protocol; // needs app.set('trust proxy', 1)
  const host = req.get("host");
  return `${proto}://${host}`;
}

export function toAbsolute(relOrAbs, base) {
  if (!relOrAbs) return relOrAbs;
  if (typeof relOrAbs !== "string") return relOrAbs;
  if (relOrAbs.startsWith("/")) return base.replace(/\/+$/, "") + relOrAbs;
  return relOrAbs;
}

export function toRelative(url, bases = []) {
  if (!url || typeof url !== "string") return url;
  if (url.startsWith("/public/")) return url;

  // strip any known bases
  for (const b of bases) {
    const clean = (b || "").replace(/\/+$/, "");
    if (clean && url.startsWith(clean)) {
      const cut = url.slice(clean.length);
      return cut.startsWith("/") ? cut : `/${cut}`;
    }
  }

  // strip generic http(s)://... if it contains /public/ later
  const m = url.match(/\/public\/.+$/);
  if (m) return m[0];

  return url; // unchanged if not matching our patterns
}

/**
 * Recursively walk any object/array and convert path-like strings to relative.
 * We’re conservative: we only touch keys that look like URL-ish fields.
 */
const URL_LIKE_KEYS = new Set([
  "url", "logoUrl", "faviconUrl",
  "image", "thumbnail", "cover", "banner",
  "imageUrl", "thumbUrl", "coverUrl", "bannerUrl",
  "path", "file", "fileUrl", "asset", "assetUrl",
]);

export function sanitizePathsToRelative(payload, bases = []) {
  if (!payload || typeof payload !== "object") return payload;

  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return sanitizePathsToRelative(v, bases);
    if (typeof v === "string") {
      // if it contains /public/, force-relative
      const m = v.match(/\/public\/.+$/);
      return m ? m[0] : toRelative(v, bases);
    }
    return v;
  };

  for (const k of Object.keys(payload)) {
    if (URL_LIKE_KEYS.has(k) || /url|image|thumb|cover|banner|path|file/i.test(k)) {
      payload[k] = walk(payload[k]);
    } else if (payload[k] && typeof payload[k] === "object") {
      payload[k] = sanitizePathsToRelative(payload[k], bases);
    }
  }
  return payload;
}
