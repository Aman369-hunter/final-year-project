// Section 5 + 6.4 rule 5: risk scores are for doctors only.
// Wraps res.json for every response: unless the caller holds a doctor token, the
// prediction blocks are removed wherever they appear in the body, at any depth.
// Default-deny: patient, lab, admin and unauthenticated callers are all filtered.
// Serializers also leave these out; this is the backstop that doesn't depend on them.

export const PREDICTION_KEYS = Object.freeze(['predictions', 'factors', 'category_scores', 'risk_level']);
const STRIP = new Set(PREDICTION_KEYS);

export function stripPredictionData(value) {
  if (Array.isArray(value)) return value.map(stripPredictionData);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (!STRIP.has(k)) out[k] = stripPredictionData(v);
    }
    return out;
  }
  return value;
}

export function predictionFilter(req, res, next) {
  const json = res.json.bind(res);
  res.json = (body) => {
    if (req.user?.role === 'doctor' || body === undefined) return json(body);
    // Round-trip first so Mongoose documents, ObjectIds and Dates become plain JSON.
    return json(stripPredictionData(JSON.parse(JSON.stringify(body))));
  };
  next();
}
