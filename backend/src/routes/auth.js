import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { ROLES, SEXES } from '../domain.js';
import { HttpError } from '../middleware/errors.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { Patient } from '../models/Patient.js';
import { User } from '../models/User.js';
import { audit } from '../services/audit.js';
import {
  REFRESH_COOKIE,
  consumeRefreshToken,
  hashPassword,
  issueRefreshToken,
  refreshCookieOptions,
  revokeRefreshToken,
  signAccessToken,
  verifyPassword,
} from '../services/tokens.js';

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

// Self-registration (Section 6.1): a patient enrols themselves. The role and
// facility are not accepted from the client — they are forced server-side, so
// this endpoint can never mint a lab, doctor or admin account.
const dobSchema = z.coerce
  .date()
  .refine((d) => !Number.isNaN(d.getTime()), { message: 'invalid_date' })
  .refine((d) => d <= new Date(), { message: 'date_of_birth_in_future' })
  .refine((d) => d >= new Date(Date.now() - 125 * 365.25 * 24 * 3600 * 1000), { message: 'date_of_birth_too_old' });

const selfRegisterSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.string().email().max(254),
    password: z.string().min(10).max(200),
    date_of_birth: dobSchema,
    sex: z.enum(SEXES),
    father_name: z.string().trim().max(120).optional(),
    mother_name: z.string().trim().max(120).optional(),
    consanguinity: z.boolean().nullable().optional(),
    ethnicity: z.string().trim().max(64).optional(),
  })
  .strict();

const registerSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.string().email().max(254),
    password: z.string().min(10).max(200),
    role: z.enum(ROLES),
    facility: z.string().trim().min(1).max(64).optional(),
    // Required when role = patient: creates the linked patient record.
    patient: z
      .object({
        date_of_birth: z.coerce.date(),
        sex: z.enum(SEXES),
        father_name: z.string().trim().max(120).optional(),
        mother_name: z.string().trim().max(120).optional(),
        consanguinity: z.boolean().optional(),
        ethnicity: z.string().trim().max(64).optional(),
        family_history: z
          .object({ affected_relative: z.boolean().optional(), relationship: z.string().trim().max(64).optional() })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((d) => d.role === 'admin' || d.facility, { path: ['facility'], message: 'required' })
  .refine((d) => d.role !== 'patient' || d.patient, { path: ['patient'], message: 'required' });

async function sendSession(res, user, activeRole) {
  const { token: refresh, expiresAt } = await issueRefreshToken(user._id);
  res.cookie(REFRESH_COOKIE, refresh, refreshCookieOptions(expiresAt));
  return signAccessToken(user, activeRole);
}

// The shape every session response returns, so the client always knows which
// role it is acting as and which others it may switch to.
const sessionUser = (user, activeRole) => ({
  id: user.id,
  name: user.name,
  role: activeRole ?? user.role,
  roles: user.allowedRoles(),
});

const switchRoleSchema = z.object({ role: z.enum(ROLES) }).strict();

export function authRouter() {
  const r = Router();

  // Section 5: rate limiting on /api/auth/*. The strict brute-force limit guards
  // the credential endpoints (login, register) only. /refresh, /me and /logout
  // are called on every page load and navigation (session resume, silent token
  // refresh on 401), so a tight limit there locks a legitimate user out; they get
  // a far more generous limit instead.
  const credentialLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.authRateLimit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'too_many_requests' },
  });
  const sessionLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.sessionRateLimit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'too_many_requests' },
  });
  r.use((req, res, next) => {
    const strict = req.path === '/login' || req.path === '/register' || req.path === '/register-patient';
    return (strict ? credentialLimiter : sessionLimiter)(req, res, next);
  });

  // Section 3.3: → { token, user: { id, name, role } }. The refresh token goes in an httpOnly cookie.
  r.post('/login', validate({ body: loginSchema }), async (req, res) => {
    const { email, password } = req.valid.body;
    const user = await User.findOne({ email: email.toLowerCase(), active: true }).select('+passwordHash');
    const ok = await verifyPassword(password, user?.passwordHash);
    if (!ok) {
      if (user) await audit(user, 'auth.login_failed', { resourceType: 'user', resourceId: user._id });
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    const token = await sendSession(res, user);
    await audit(user, 'auth.login', { resourceType: 'user', resourceId: user._id });
    res.json({ token, user: sessionUser(user) });
  });

  // Addition to Section 3.3: rotate the refresh cookie, return a new access token.
  r.post('/refresh', async (req, res) => {
    const user = await consumeRefreshToken(req.cookies?.[REFRESH_COOKIE]);
    if (!user) {
      res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
      return res.status(401).json({ error: 'invalid_refresh_token' });
    }
    // The refresh cookie says who you are, not which role you were acting as,
    // so the client sends its current role back and we honour it when allowed.
    const asked = req.body?.role;
    const active = asked && user.allowedRoles().includes(asked) ? asked : user.role;
    const token = await sendSession(res, user, active);
    res.json({ token, user: sessionUser(user, active) });
  });

  // One login, several dashboards: swap the ACTIVE role on the access token.
  // Only roles the account already holds are allowed, so this grants nothing new.
  r.post('/switch-role', authenticate, validate({ body: switchRoleSchema }), async (req, res) => {
    const { role } = req.valid.body;
    if (!req.user.allowedRoles().includes(role)) {
      throw new HttpError(403, 'role_not_permitted', 'This account cannot act as that role.');
    }
    const token = signAccessToken(req.user, role);
    await audit(req.user, 'auth.switch_role', { resourceType: 'user', resourceId: req.user._id, meta: { role } });
    res.json({ token, user: sessionUser(req.user, role) });
  });

  // Addition to Section 3.3: revoke the current refresh token.
  r.post('/logout', async (req, res) => {
    await revokeRefreshToken(req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
    res.status(204).end();
  });

  r.get('/me', authenticate, (req, res) => {
    res.json({ user: req.user.toPublic() });
  });

  // Public patient enrolment. Creates the User + linked Patient record and signs
  // the new patient straight in. role/facility are server-side constants.
  r.post('/register-patient', validate({ body: selfRegisterSchema }), async (req, res) => {
    if (!config.allowSelfRegistration) throw new HttpError(403, 'self_registration_disabled', 'Patients are enrolled by the clinic.');
    const b = req.valid.body;
    const email = b.email.toLowerCase();
    if (await User.exists({ email })) throw new HttpError(409, 'email_taken', 'An account with that email already exists.');

    const user = await User.create({
      name: b.name,
      email,
      passwordHash: await hashPassword(b.password),
      role: 'patient',
      facility: config.defaultFacility,
    });
    try {
      await Patient.create({
        user: user._id,
        name: b.name,
        date_of_birth: b.date_of_birth,
        sex: b.sex,
        father_name: b.father_name || undefined,
        mother_name: b.mother_name || undefined,
        consanguinity: b.consanguinity ?? undefined,
        ethnicity: b.ethnicity || undefined,
        facility: config.defaultFacility,
      });
    } catch (err) {
      await User.deleteOne({ _id: user._id }); // never leave a login with no patient record
      throw err;
    }

    const token = await sendSession(res, user);
    await audit(user, 'patient.self_register', { resourceType: 'user', resourceId: user._id });
    res.status(201).json({ token, user: sessionUser(user) });
  });

  r.post('/register', authenticate, requireRole('admin'), validate({ body: registerSchema }), async (req, res) => {
    const body = req.valid.body;
    const user = await User.create({
      name: body.name,
      email: body.email,
      passwordHash: await hashPassword(body.password),
      role: body.role,
      facility: body.facility,
    });
    if (body.role === 'patient') {
      try {
        await Patient.create({ ...body.patient, name: body.name, user: user._id, facility: body.facility });
      } catch (err) {
        await User.deleteOne({ _id: user._id });
        throw err;
      }
    }
    await audit(req.user, 'user.register', { resourceType: 'user', resourceId: user._id, meta: { role: body.role } });
    res.status(201).json({ user: user.toPublic() });
  });

  return r;
}
