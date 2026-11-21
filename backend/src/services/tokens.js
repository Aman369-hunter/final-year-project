// Short-lived JWT access tokens + opaque, rotating refresh tokens.
// Refresh tokens live in an httpOnly cookie; only their sha256 is stored.
import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config, BCRYPT_COST, JWT_AUDIENCE, JWT_ISSUER } from '../config.js';
import { User } from '../models/User.js';

export const REFRESH_COOKIE = 'rt';
const MAX_REFRESH_TOKENS_PER_USER = 10;

export function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_COST);
}

let dummyHash;
export async function verifyPassword(password, passwordHash) {
  // Compare against a dummy hash when the user doesn't exist, so response time
  // doesn't reveal which emails are registered.
  dummyHash ??= await bcrypt.hash('timing-equaliser', BCRYPT_COST);
  return bcrypt.compare(password, passwordHash || dummyHash).then((ok) => ok && Boolean(passwordHash));
}

// activeRole: which of the user's allowed roles this token acts as. Callers must
// have validated it against user.allowedRoles() first.
export function signAccessToken(user, activeRole) {
  return jwt.sign({ role: activeRole ?? user.role }, config.jwtAccessSecret, {
    subject: String(user._id),
    expiresIn: config.jwtAccessTtl,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, config.jwtAccessSecret, {
    algorithms: ['HS256'],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export async function issueRefreshToken(userId) {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.refreshTtlDays * 24 * 3600 * 1000);
  await User.updateOne({ _id: userId }, { $pull: { refreshTokens: { expiresAt: { $lte: now } } } });
  await User.updateOne(
    { _id: userId },
    { $push: { refreshTokens: { $each: [{ hash: sha256(token), expiresAt }], $slice: -MAX_REFRESH_TOKENS_PER_USER } } },
  );
  return { token, expiresAt };
}

// Single use: the matching token is pulled atomically, so a replayed token fails.
export async function consumeRefreshToken(token) {
  if (!token) return null;
  const hash = sha256(token);
  const user = await User.findOneAndUpdate(
    { refreshTokens: { $elemMatch: { hash, expiresAt: { $gt: new Date() } } }, active: true },
    { $pull: { refreshTokens: { hash } } },
  );
  return user;
}

export async function revokeRefreshToken(token) {
  if (!token) return;
  await User.updateOne({ 'refreshTokens.hash': sha256(token) }, { $pull: { refreshTokens: { hash: sha256(token) } } });
}

export function refreshCookieOptions(expiresAt) {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'strict',
    path: '/api/auth',
    ...(expiresAt ? { expires: expiresAt } : {}),
  };
}
