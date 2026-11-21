// zod validation for every route. Parsed values land on req.valid.{body,query,params}.
// Issues report path + code only, never the received value.

export function validate(schemas) {
  return (req, res, next) => {
    req.valid = req.valid || {};
    for (const [part, schema] of Object.entries(schemas)) {
      const result = schema.safeParse(req[part] ?? {});
      if (!result.success) {
        return res.status(400).json({
          error: 'validation_failed',
          issues: result.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code })),
        });
      }
      req.valid[part] = result.data;
    }
    next();
  };
}
