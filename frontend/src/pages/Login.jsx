// One sign-in for the whole system. The account's roles decide which dashboards
// the navbar opens; the server still filters every response by the ACTIVE role,
// so a single login is a convenience, never a widening of access.
import { motion } from 'framer-motion';
import { useState } from 'react';
import { useAuth } from '../lib/useAuth.jsx';
import PatientRegister from './PatientRegister.jsx';

const PILLARS = [
  {
    title: 'Patients',
    body: 'Answer a plain-language symptom questionnaire and follow each check. Never shown a risk score.',
    icon: 'M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0ZM4 21a8 8 0 0 1 16 0',
  },
  {
    title: 'Laboratory',
    body: 'Capture live device vitals, then enter enzyme, biomarker and genetic results against their reference ranges.',
    icon: 'M9 3v6l-5 9a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-5-9V3M8 3h8M7 15h10',
  },
  {
    title: 'Clinicians',
    body: 'Review the scored differential across six lysosomal storage diseases, with the factors behind every score.',
    icon: 'M3 3v18h18M7 15l4-5 3 3 5-7',
  },
];

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('demo@lsd.test');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [registering, setRegistering] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(
        err.status === 401
          ? 'Wrong email or password.'
          : err.status === 429
            ? 'Too many attempts from here. Wait a few minutes (AUTH_RATE_LIMIT in backend/.env raises the limit for local testing).'
            : err.message,
      );
    } finally {
      setBusy(false);
    }
  }

  if (registering) return <PatientRegister onCancel={() => setRegistering(false)} />;

  return (
    <div className="grid items-center gap-12 py-6 lg:grid-cols-[1.1fr_minmax(0,26rem)] lg:gap-16 lg:py-14">
      {/* Pitch */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="hidden lg:block"
      >
        <span className="inline-flex items-center gap-2 rounded-full border border-accent-line bg-accent-bg px-3 py-1 text-label font-medium text-accent-fg">
          <span className="h-1.5 w-1.5 rounded-full bg-accent-solid" aria-hidden />
          Clinical decision support
        </span>
        <h1 className="mt-5 max-w-xl text-4xl font-semibold leading-[1.1] tracking-tight text-fg">
          Earlier signals for six lysosomal storage diseases.
        </h1>
        <p className="mt-4 max-w-lg text-base leading-relaxed text-fg-2">
          One pathway from the patient’s own words, through the laboratory bench, to a clinician’s decision — with every
          score traceable to the finding that produced it.
        </p>

        <ul className="mt-9 grid gap-5 sm:grid-cols-3">
          {PILLARS.map((p, i) => (
            <motion.li
              key={p.title}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: 'easeOut', delay: 0.1 + i * 0.08 }}
            >
              <span className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-surface text-fg-2 shadow-card" aria-hidden>
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d={p.icon} />
                </svg>
              </span>
              <h2 className="mt-3 text-body font-semibold text-fg">{p.title}</h2>
              <p className="mt-1 text-label leading-relaxed text-fg-3">{p.body}</p>
            </motion.li>
          ))}
        </ul>
      </motion.section>

      {/* Sign-in */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut', delay: 0.06 }}
        className="mx-auto w-full max-w-sm lg:mx-0"
      >
        <div className="card p-7">
          <h2 className="text-title text-fg">Sign in</h2>
          <p className="mt-1 text-label text-fg-3">One account opens every dashboard it has rights to.</p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <Field label="Email">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                autoComplete="username"
                className="input"
              />
            </Field>
            <Field label="Password">
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                autoComplete="current-password"
                autoFocus
                className="input"
              />
            </Field>
            {error && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-lg bg-danger-bg px-3 py-2 text-label text-danger-fg"
              >
                {error}
              </motion.p>
            )}
            <button disabled={busy} className="btn-primary w-full">
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="mt-6 flex items-center gap-3">
            <span className="h-px flex-1 bg-line" />
            <span className="text-micro uppercase tracking-wider text-fg-3">or</span>
            <span className="h-px flex-1 bg-line" />
          </div>

          <button type="button" onClick={() => setRegistering(true)} className="btn-ghost mt-4 w-full">
            Register a new patient
          </button>
        </div>

        <p className="mt-4 rounded-lg border border-line bg-subtle px-4 py-3 text-micro leading-relaxed text-fg-3">
          Project login <code className="text-fg-2">demo@lsd.test</code> opens all three dashboards. Single-role logins{' '}
          <code className="text-fg-2">patient@</code>, <code className="text-fg-2">lab@</code> and{' '}
          <code className="text-fg-2">doctor@lsd.test</code> still work. Password is <code className="text-fg-2">SEED_PASSWORD</code>{' '}
          from <code className="text-fg-2">backend/.env</code>.
        </p>
      </motion.div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-label font-medium text-fg-2">{label}</span>
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}
