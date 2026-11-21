// Section 6.1 "Registration": a patient enrols themselves. Identity captured
// here is what the doctor sees on the case, so each person gets their own
// account and their own cases instead of everything landing on one login.
// Age is derived from the date of birth, never typed — the scoring engine needs
// a real DOB, and a typed age would drift as time passes.
import { useState } from 'react';
import { useAuth } from '../lib/useAuth.jsx';

const SEXES = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'other', label: 'Other' },
];

const blank = {
  name: '',
  date_of_birth: '',
  sex: '',
  father_name: '',
  mother_name: '',
  ethnicity: '',
  email: '',
  password: '',
};

export function ageFromDob(dob) {
  if (!dob) return null;
  const d = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const years = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
  if (years < 0 || years > 125) return null;
  return Math.round(years * 10) / 10;
}

// Mirrors the backend selfRegisterSchema so the patient is told what is wrong
// here, in their own words, rather than reading a validation path.
export function registerProblems(f) {
  const out = [];
  if (!f.name.trim()) out.push('Enter the patient’s full name.');
  if (!f.date_of_birth) out.push('Enter the date of birth.');
  else if (ageFromDob(f.date_of_birth) == null) out.push('That date of birth is not a real past date.');
  if (!f.sex) out.push('Choose a sex — the risk model needs it (several of these conditions are X-linked).');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) out.push('Enter a valid email address to sign in with.');
  if (f.password.length < 10) out.push('Use a password of at least 10 characters.');
  return out;
}

export default function PatientRegister({ onCancel }) {
  const { registerPatient } = useAuth();
  const [f, setF] = useState(blank);
  const [problems, setProblems] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => {
    setF((prev) => ({ ...prev, [k]: e.target.value }));
    setProblems([]);
    setError(null);
  };

  const age = ageFromDob(f.date_of_birth);

  async function submit(e) {
    e.preventDefault();
    const bad = registerProblems(f);
    if (bad.length) {
      setProblems(bad);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await registerPatient({
        name: f.name.trim(),
        email: f.email.trim(),
        password: f.password,
        date_of_birth: f.date_of_birth,
        sex: f.sex,
        ...(f.father_name.trim() ? { father_name: f.father_name.trim() } : {}),
        ...(f.mother_name.trim() ? { mother_name: f.mother_name.trim() } : {}),
        ...(f.ethnicity.trim() ? { ethnicity: f.ethnicity.trim() } : {}),
      });
    } catch (err) {
      setError(
        err.status === 409
          ? 'An account with that email already exists. Sign in instead.'
          : err.status === 403
            ? 'Self-registration is turned off on this server. The clinic has to enrol you.'
            : err.status === 429
              ? 'Too many sign-in and registration attempts from here. Wait a few minutes and try again (AUTH_RATE_LIMIT in backend/.env raises the limit for local testing).'
              : err.message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-10 max-w-lg">
      <h1 className="text-title text-fg">Register a patient</h1>
      <p className="mt-1 text-body text-fg-3">
        This creates a new patient account. Every check you start is saved under this name, and the reviewing doctor
        sees it on the case.
      </p>

      <form onSubmit={submit} className="card mt-6 space-y-4 p-5">
        <Field label="Full name" required>
          <Input value={f.name} onChange={set('name')} autoFocus autoComplete="name" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date of birth" required hint={age != null ? `${age} years old` : undefined}>
            <Input type="date" value={f.date_of_birth} onChange={set('date_of_birth')} max={new Date().toISOString().slice(0, 10)} />
          </Field>
          <Field label="Sex" required>
            <select value={f.sex} onChange={set('sex')} className="mt-1 w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-body text-fg">
              <option value="">Choose…</option>
              {SEXES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Father’s name">
            <Input value={f.father_name} onChange={set('father_name')} />
          </Field>
          <Field label="Mother’s name">
            <Input value={f.mother_name} onChange={set('mother_name')} />
          </Field>
        </div>

        <Field label="Ethnicity or background" hint="Optional. Some of these conditions are more common in particular populations.">
          <Input value={f.ethnicity} onChange={set('ethnicity')} placeholder="e.g. South Asian" />
        </Field>

        <div className="border-t border-line pt-4">
          <p className="text-label font-medium text-fg-2">Sign-in details</p>
          <div className="mt-2 grid gap-4 sm:grid-cols-2">
            <Field label="Email" required>
              <Input type="email" value={f.email} onChange={set('email')} autoComplete="email" />
            </Field>
            <Field label="Password" required hint="At least 10 characters.">
              <Input type="password" value={f.password} onChange={set('password')} autoComplete="new-password" />
            </Field>
          </div>
        </div>

        {problems.length > 0 && (
          <div className="rounded-md bg-warn-bg px-3 py-2 text-body text-warn-fg">
            <p className="font-medium">Check these before continuing:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {problems.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        )}
        {error && <p className="rounded-md bg-danger-bg px-3 py-2 text-body text-danger-fg">{error}</p>}

        <div className="flex items-center gap-3">
          <button disabled={busy} className="rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary hover:bg-primary-hover disabled:opacity-40">
            {busy ? 'Creating account…' : 'Create account'}
          </button>
          <button type="button" onClick={onCancel} className="text-body text-accent-fg hover:underline">
            I already have an account
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children, required, hint }) {
  return (
    <label className="block">
      <span className="text-body text-fg-2">
        {label}
        {required && <span className="ml-0.5 text-danger-fg">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-label text-fg-3">{hint}</span>}
    </label>
  );
}

function Input(props) {
  return <input {...props} className="mt-1 w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-body text-fg" />;
}
