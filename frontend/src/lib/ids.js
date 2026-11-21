// Short, human-readable case reference for the UI. Real ids are 24-hex ObjectIds, so the
// last six characters are distinctive; scripted demo ids are already readable words.
export const shortId = (id) => (String(id).startsWith('demo-') ? String(id).slice(5) : String(id).slice(-6));
