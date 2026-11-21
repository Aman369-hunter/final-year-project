// All configuration comes from the environment (see .env.example).
// Values are read lazily so tests can set process.env before first use.

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name} (see backend/.env.example)`);
  }
  return value;
}

export const config = {
  get port() {
    return Number(process.env.PORT) || 4000;
  },
  get mongoUri() {
    return process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/lsd_cdss';
  },
  get jwtAccessSecret() {
    return required('JWT_ACCESS_SECRET');
  },
  get jwtAccessTtl() {
    return process.env.JWT_ACCESS_TTL || '15m';
  },
  get refreshTtlDays() {
    return Number(process.env.REFRESH_TTL_DAYS) || 7;
  },
  get geneticsKey() {
    return required('GENETICS_ENC_KEY');
  },
  get corsOrigins() {
    return (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  },
  get authRateLimit() {
    return Number(process.env.AUTH_RATE_LIMIT) || 20;
  },
  // Session upkeep (refresh/me/logout): generous, since the app calls these on
  // every load and navigation.
  get sessionRateLimit() {
    return Number(process.env.SESSION_RATE_LIMIT) || 240;
  },
  // Internal only: Node is the engine's sole client (Section 2).
  get engineUrl() {
    return process.env.ENGINE_URL || 'http://127.0.0.1:8000';
  },
  get engineTimeoutMs() {
    return Number(process.env.ENGINE_TIMEOUT_MS) || 10_000;
  },
  // The facility a self-registered patient joins, so their cases land in the
  // same worklist as the seeded lab and doctor. Must match seed.js FACILITY.
  get defaultFacility() {
    return process.env.DEFAULT_FACILITY || 'facility-001';
  },
  // Self-registration is a dev/demo convenience. Off in production, where
  // patients are enrolled by the clinic through the admin register endpoint.
  get allowSelfRegistration() {
    if (process.env.ALLOW_SELF_REGISTRATION != null) return process.env.ALLOW_SELF_REGISTRATION === 'true';
    return !(process.env.NODE_ENV === 'production');
  },
  get isProduction() {
    return process.env.NODE_ENV === 'production';
  },
};

// Section 5: bcrypt cost factor >= 12. Not configurable downwards on purpose.
export const BCRYPT_COST = 12;

export const JWT_ISSUER = 'lsd-cdss';
export const JWT_AUDIENCE = 'lsd-cdss-api';
