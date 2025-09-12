
export function renderString(tpl, context = {}) {
  if (!tpl) return "";
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, key) => {
    const val = key.split(".").reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), context);
    return (val === undefined || val === null) ? `{{${key}}}` : String(val);
  });
}

// Convenience: render subject/text/html with same context
export function renderTemplate({ subject, text, html }, context = {}) {
  return {
    subject: renderString(subject, context),
    text:    renderString(text, context),
    html:    renderString(html, context),
  };
}
