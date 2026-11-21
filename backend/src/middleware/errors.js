// Errors never echo request values back (Section 11 rule 4: no patient data in errors).

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

export function notFound(_req, res) {
  res.status(404).json({ error: 'not_found' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (err instanceof HttpError) {
    // violations are engine field paths + rule text, never request values.
    return res.status(err.status).json({ error: err.code, message: err.message, ...(err.violations && { violations: err.violations }) });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'invalid_json' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'payload_too_large' });
  }
  if (err.name === 'ValidationError' && err.errors) {
    return res.status(400).json({
      error: 'validation_failed',
      issues: Object.keys(err.errors).map((path) => ({ path, code: 'invalid' })),
    });
  }
  if (err.code === 11000) {
    return res.status(409).json({ error: 'duplicate' });
  }
  // Log the error class only: messages and stacks can carry field values.
  console.error('[error]', err.name, err.code ?? '');
  return res.status(500).json({ error: 'internal_error' });
}
