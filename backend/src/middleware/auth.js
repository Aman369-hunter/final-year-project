import { User } from '../models/User.js';
import { verifyAccessToken } from '../services/tokens.js';

// Verifies the bearer token and loads the current user, so a deactivated
// account or changed role takes effect immediately.
export async function authenticate(req, res, next) {
  const header = req.get('authorization') || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'unauthenticated' });
  }
  let payload;
  try {
    payload = verifyAccessToken(header.slice(7));
  } catch {
    return res.status(401).json({ error: 'invalid_token' });
  }
  const user = await User.findById(payload.sub);
  if (!user || !user.active) {
    return res.status(401).json({ error: 'invalid_token' });
  }
  // The token names which role it is acting as. It must still be one the account
  // is allowed, so revoking a role takes effect on the next request even though
  // the token was signed earlier. Everything downstream reads user.role, so
  // setting it here keeps one code path for single- and multi-role accounts.
  // This is an in-memory document that is never saved.
  const active = payload.role ?? user.role;
  if (!user.allowedRoles().includes(active)) {
    return res.status(401).json({ error: 'invalid_token' });
  }
  user.role = active;
  req.user = user;
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  };
}
