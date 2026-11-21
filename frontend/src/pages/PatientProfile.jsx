// Section 6.1 "Registration and profile". Shows the demographics captured at
// registration (read-only) and lets the patient maintain the facts only they
// know: consanguinity, ethnicity and family history. No scores here either.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { ListSkeleton, PageSkeleton } from '../components/Skeleton.jsx';
import { Card } from '../components/ui.jsx';
import { sexLabel } from '../components/ui.jsx';

const RELATIONSHIPS = ['parent', 'sibling', 'child', 'grandparent', 'aunt_or_uncle', 'cousin', 'other'];
const relLabel = (r) => (r ? r.replace(/_/g, ' ') : '');

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-sm text-fg-2">{label}</span>
      {children}
    </label>
  );
}

export default function PatientProfile() {
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .profile()
      .then((d) => {
        setProfile(d.profile);
        setForm({
          father_name: d.profile.father_name ?? '',
          mother_name: d.profile.mother_name ?? '',
          consanguinity: d.profile.consanguinity,
          ethnicity: d.profile.ethnicity ?? '',
          affected_relative: d.profile.family_history.affected_relative,
          relationship: d.profile.family_history.relationship ?? '',
        });
      })
      .catch((e) => setError(e.message));
  }, []);

  const set = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    setSaved(false);
  };

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const patch = {
        father_name: form.father_name.trim() || null,
        mother_name: form.mother_name.trim() || null,
        consanguinity: form.consanguinity ?? null,
        ethnicity: form.ethnicity.trim() || null,
        family_history: {
          affected_relative: form.affected_relative ?? null,
          relationship: form.affected_relative ? form.relationship || null : null,
        },
      };
      const d = await api.updateProfile(patch);
      setProfile(d.profile);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !profile) return <p className="rounded-md bg-danger-bg px-4 py-3 text-sm text-danger-fg">{error}</p>;
  if (!profile || !form) return <PageSkeleton rows={2} />;

  const dob = profile.date_of_birth ? new Date(profile.date_of_birth).toLocaleDateString() : '';

  return (
    <div className="space-y-6">
      <div>
        <Link to="/patient" className="text-sm text-accent-fg hover:underline">
          ← Back to your checks
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-fg">Your profile</h1>
        <p className="mt-1 text-sm text-fg-3">This information helps the clinical team understand your background.</p>
      </div>

      <Card title="About you" subtitle="Set when your account was created. Contact the clinic if any of this is wrong.">
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-fg-3">Name</dt>
            <dd className="mt-0.5 font-medium text-fg">{profile.name}</dd>
          </div>
          <div>
            <dt className="text-fg-3">Date of birth</dt>
            <dd className="mt-0.5 font-medium text-fg">{dob}</dd>
          </div>
          <div>
            <dt className="text-fg-3">Age</dt>
            <dd className="mt-0.5 font-medium text-fg">{profile.age_years} yrs</dd>
          </div>
          <div>
            <dt className="text-fg-3">Sex</dt>
            <dd className="mt-0.5 font-medium text-fg">{sexLabel(profile.sex)}</dd>
          </div>
        </dl>
      </Card>

      <form onSubmit={save}>
        <Card
          title="Background and family history"
          subtitle="You can update these at any time."
          right={
            <div className="flex items-center gap-3">
              {saved && <span className="text-xs font-medium text-ok-fg">Saved</span>}
              <button disabled={busy} className="rounded-md bg-accent-solid px-4 py-2 text-sm font-medium text-on-primary hover:bg-accent-solid-hover disabled:opacity-40">
                {busy ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          }
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Father’s name">
              <input
                value={form.father_name}
                onChange={(e) => set('father_name', e.target.value)}
                className="mt-1 w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-fg"
              />
            </Field>

            <Field label="Mother’s name">
              <input
                value={form.mother_name}
                onChange={(e) => set('mother_name', e.target.value)}
                className="mt-1 w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-fg"
              />
            </Field>

            <Field label="Are your parents blood relatives (for example cousins)?">
              <select
                value={form.consanguinity === true ? 'yes' : form.consanguinity === false ? 'no' : ''}
                onChange={(e) => set('consanguinity', e.target.value === '' ? null : e.target.value === 'yes')}
                className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
              >
                <option value="">Prefer not to say / unknown</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </Field>

            <Field label="Ethnicity or background">
              <input
                value={form.ethnicity}
                onChange={(e) => set('ethnicity', e.target.value)}
                placeholder="e.g. South Asian"
                className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
              />
            </Field>

            <Field label="Does anyone in your family have a similar condition?">
              <select
                value={form.affected_relative === true ? 'yes' : form.affected_relative === false ? 'no' : ''}
                onChange={(e) => set('affected_relative', e.target.value === '' ? null : e.target.value === 'yes')}
                className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
              >
                <option value="">Prefer not to say / unknown</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </Field>

            {form.affected_relative === true && (
              <Field label="Which relative?">
                <select
                  value={form.relationship}
                  onChange={(e) => set('relationship', e.target.value)}
                  className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm capitalize"
                >
                  <option value="">Choose…</option>
                  {RELATIONSHIPS.map((r) => (
                    <option key={r} value={r}>
                      {relLabel(r)}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
          {error && <p className="mt-4 rounded-md bg-danger-bg px-4 py-3 text-sm text-danger-fg">{error}</p>}
        </Card>
      </form>
    </div>
  );
}
