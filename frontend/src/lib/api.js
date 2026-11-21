// Thin client for the live backend. The access token is held in memory and sent
// as a bearer; the refresh cookie is httpOnly and handled by the browser. On a
// 401 we try one silent refresh, then replay the request.
import { DemoBlockedError, isDemo } from '../demo/mode.js';
import { demoApi } from '../demo/adapter.js';

let accessToken = null;
const tokenListeners = new Set();

// One login can act as several roles (patient / lab / doctor). The ACTIVE role
// lives on the access token; we remember the client's choice so a reload or a
// silent refresh lands back on the same dashboard instead of the primary role.
const ROLE_KEY = 'lsd-active-role';
let activeRole = null;
try {
  activeRole = localStorage.getItem(ROLE_KEY);
} catch {
  activeRole = null;
}
function rememberRole(role) {
  activeRole = role ?? null;
  try {
    if (role) localStorage.setItem(ROLE_KEY, role);
    else localStorage.removeItem(ROLE_KEY);
  } catch {
    /* private mode: the role just won't survive a reload */
  }
}
export const getActiveRole = () => activeRole;

export function getToken() {
  return accessToken;
}

export function onToken(fn) {
  tokenListeners.add(fn);
  return () => tokenListeners.delete(fn);
}

function setToken(t) {
  accessToken = t;
  for (const fn of tokenListeners) fn(t);
}

async function raw(path, { method = 'GET', body, auth = true } = {}) {
  // Hard guard (write isolation): in demo mode NOTHING reaches the network, so no demo
  // action can ever read or modify real data. The live session token is left untouched.
  if (isDemo()) throw new DemoBlockedError(method, path);
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth && accessToken) headers.authorization = `Bearer ${accessToken}`;
  return fetch(`/api${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function request(path, opts = {}) {
  let res = await raw(path, opts);
  if (res.status === 401 && opts.auth !== false && accessToken) {
    // one silent refresh attempt
    const refreshed = await raw('/auth/refresh', { method: 'POST', auth: false, body: { role: activeRole } });
    if (refreshed.ok) {
      setToken((await refreshed.json()).token);
      res = await raw(path, opts);
    } else {
      // The session is genuinely gone (expired, signed out elsewhere, or the
      // database was restarted). Drop the token so the app shows the sign-in
      // page instead of a mounted screen repeating "unauthenticated".
      setToken(null);
    }
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

const live = {
  async login(email, password) {
    const data = await request('/auth/login', { method: 'POST', body: { email, password }, auth: false });
    setToken(data.token);
    rememberRole(data.user.role);
    return data.user;
  },
  // Swap which role this session is acting as. The server only allows roles the
  // account already holds, so this can never widen access.
  async switchRole(role) {
    const data = await request('/auth/switch-role', { method: 'POST', body: { role } });
    setToken(data.token);
    rememberRole(data.user.role);
    return data.user;
  },
  // Patient self-enrolment. Signs the new patient in, like login.
  async registerPatient(details) {
    const data = await request('/auth/register-patient', { method: 'POST', body: details, auth: false });
    setToken(data.token);
    rememberRole(data.user.role);
    return data.user;
  },
  async me() {
    return (await request('/auth/me')).user;
  },
  async tryResume() {
    // Restore a session from the refresh cookie on page load, back onto whichever
    // dashboard the user was last using.
    const res = await raw('/auth/refresh', { method: 'POST', auth: false, body: { role: activeRole } });
    if (!res.ok) return null;
    const data = await res.json();
    setToken(data.token);
    rememberRole(data.user.role);
    return data.user;
  },
  async logout() {
    try {
      await request('/auth/logout', { method: 'POST' });
    } finally {
      setToken(null);
      rememberRole(null);
    }
  },
  listCases: (query = '') => request(`/cases${query}`),
  getCase: (id) => request(`/cases/${id}`),
  createCase: (symptoms) => request('/cases', { method: 'POST', body: symptoms ? { symptoms } : {} }),
  transition: (id, to_state, reason) => request(`/cases/${id}/transition`, { method: 'POST', body: { to_state, reason } }),
  patchSymptoms: (id, symptoms) => request(`/cases/${id}/symptoms`, { method: 'PATCH', body: { symptoms } }),
  patchVitals: (id, vitals) => request(`/cases/${id}/vitals`, { method: 'PATCH', body: vitals }),
  patchLabs: (id, labs) => request(`/cases/${id}/labs`, { method: 'PATCH', body: labs }),
  release: (id, note) => request(`/cases/${id}/release`, { method: 'POST', body: note ? { note } : {} }),
  profile: () => request('/patients/me'),
  updateProfile: (patch) => request('/patients/me', { method: 'PATCH', body: patch }),
  symptomCatalog: () => request('/reference/symptoms'),
  variantGenes: () => request('/reference/variants'),
  variantsFor: (gene) => request(`/reference/variants/${gene}`),
};

// Test seam: the real-backend implementations, so demo.test.js can prove the raw() guard
// blocks them even if a future change routes a call around the demo adapter.
export const _live = live;

// Calls that have a demo equivalent. In demo mode they are answered from the in-memory
// store; otherwise they go to the real backend exactly as before.
const DEMO_ABLE = ['me', 'listCases', 'getCase', 'createCase', 'transition', 'release', 'patchSymptoms', 'patchVitals', 'patchLabs', 'profile', 'updateProfile', 'symptomCatalog', 'variantGenes', 'variantsFor'];

export const api = {
  ...live,
  ...Object.fromEntries(DEMO_ABLE.map((k) => [k, (...args) => (isDemo() ? demoApi[k](...args) : live[k](...args))])),
  // Auth never runs in demo mode: no sign-in, no refresh, and above all no sign-out,
  // so the live session (token + cookie) is exactly as it was when demo was switched on.
  login: (...a) => {
    if (isDemo()) throw new DemoBlockedError('POST', '/auth/login');
    return live.login(...a);
  },
  registerPatient: (...a) => {
    if (isDemo()) throw new DemoBlockedError('POST', '/auth/register-patient');
    return live.registerPatient(...a);
  },
  switchRole: (...a) => {
    if (isDemo()) throw new DemoBlockedError('POST', '/auth/switch-role');
    return live.switchRole(...a);
  },
  tryResume: () => (isDemo() ? Promise.resolve(null) : live.tryResume()),
  logout: () => (isDemo() ? Promise.resolve() : live.logout()),
};
