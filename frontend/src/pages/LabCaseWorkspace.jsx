// Lab case workspace (Section 6.2). The technician claims the case, records a
// device session, enters lab values, and either submits to the doctor or
// rejects the sample. No predictions are shown anywhere.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { isDemo } from '../demo/mode.js';
import { api } from '../lib/api.js';
import { ListSkeleton, PageSkeleton } from '../components/Skeleton.jsx';
import { shortId } from '../lib/ids.js';
import { Card, Empty, StateBadge, sexLabel } from '../components/ui.jsx';
import DeviceCapture from '../lab/DeviceCapture.jsx';
import LabsForm from '../lab/LabsForm.jsx';

export default function LabCaseWorkspace() {
  const { id } = useParams();
  const [c, setC] = useState(null);
  const [error, setError] = useState(null);
  const [banner, setBanner] = useState(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  async function reload() {
    try {
      setC((await api.getCase(id)).case);
    } catch (e) {
      setError(e.message);
    }
  }
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) return <Empty>Could not load the case: {error}</Empty>;
  if (!c) return <PageSkeleton rows={2} />;

  const act = async (fn, msg) => {
    setBanner(null);
    try {
      await fn();
      await reload();
      if (msg) setBanner({ kind: 'ok', text: msg });
    } catch (e) {
      setBanner({ kind: 'error', text: e.body?.message || e.message });
    }
  };

  const claim = () => act(() => api.transition(id, 'LAB_PENDING'), 'Case claimed. You can now record the device session and enter values.');
  const submit = () => act(() => api.transition(id, 'DOCTOR_REVIEW'), 'Submitted to the doctor for review.' + (isDemo() ? ' Demo mode: a pre-computed scripted result is attached for the doctor; nothing was recomputed or saved.' : ''));
  const reject = () =>
    act(async () => {
      await api.transition(id, 'LAB_REJECTED', reason.trim());
      setRejecting(false);
      setReason('');
    }, 'Sample rejected and returned for recollection.');
  const saveVitals = (summary) => act(() => api.patchVitals(id, summary), 'Device session saved to the case.');

  const canEnter = c.state === 'LAB_PENDING';

  return (
    <div className="space-y-5">
      <Link to="/lab" className="text-sm text-accent-fg hover:underline">← Back to worklist</Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-fg">Patient {c.patient?.age_years} y · {sexLabel(c.patient?.sex)}</h1>
            <StateBadge state={c.state} />
          </div>
          <p className="mt-0.5 text-sm text-fg-3">Case {shortId(c.id)} · facility {c.facility}</p>
        </div>
        <div className="flex gap-2">
          {c.state === 'SUBMITTED' && (
            <button onClick={claim} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-on-primary hover:bg-primary-hover">Claim case</button>
          )}
          {canEnter && (
            <>
              <button onClick={() => setRejecting((v) => !v)} className="rounded-md px-3 py-1.5 text-sm text-danger-fg ring-1 ring-danger-line hover:bg-danger-bg">Reject sample</button>
              <button onClick={submit} className="rounded-md bg-ok-solid px-3 py-1.5 text-sm font-medium text-on-primary hover:brightness-110">Submit to doctor</button>
            </>
          )}
        </div>
      </header>

      {banner && (
        <p className={`rounded-md px-3 py-2 text-sm ${banner.kind === 'ok' ? 'bg-ok-bg text-ok-fg' : 'bg-danger-bg text-danger-fg'}`}>{banner.text}</p>
      )}

      {rejecting && (
        <Card title="Reject sample">
          <p className="mb-2 text-sm text-fg-2">The case returns to the patient for recollection. Give a reason.</p>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="w-full rounded-md border border-line-strong p-2 text-sm" placeholder="e.g. Haemolysed sample, insufficient volume" />
          <div className="mt-2 flex justify-end gap-2">
            <button onClick={() => setRejecting(false)} className="rounded-md px-3 py-1.5 text-sm ring-1 ring-line-strong hover:bg-subtle">Cancel</button>
            <button onClick={reject} disabled={!reason.trim()} className="rounded-md bg-danger-solid px-3 py-1.5 text-sm font-medium text-on-primary hover:brightness-110 disabled:opacity-40">Confirm rejection</button>
          </div>
        </Card>
      )}

      {c.state === 'SUBMITTED' && (
        <Card><Empty hint="Use “Claim case” at the top right, then connect a device or start the scripted stream.">Nothing to record yet.</Empty></Card>
      )}

      {c.state === 'LAB_REJECTED' && (
        <Card title="Returned for recollection"><p className="text-sm text-fg-2">Reason given: {c.rejection?.reason ?? '—'}. Waiting for the patient to resubmit.</p></Card>
      )}

      {canEnter && (
        <>
          <Card title="Live vitals capture" subtitle="ESP32 sensors via Web Serial, or the replay fixture when no device is attached. Supporting evidence only — not diagnostic.">
            <DeviceCapture onSave={saveVitals} />
          </Card>

          {c.vitals && (
            <Card title="Saved device session">
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-4">
                {[
                  ['Median HR', `${c.vitals.heart_rate_bpm ?? '—'} bpm`],
                  ['Median SpO₂', `${c.vitals.spo2_pct ?? '—'} %`],
                  ['Temperature', `${c.vitals.temperature_c ?? '—'} °C`],
                  ['Arrhythmia', c.vitals.ecg?.arrhythmia_flag ? 'flagged' : 'none'],
                  ['Tremor index', c.vitals.activity?.tremor_index ?? '—'],
                  ['Mobility', c.vitals.activity?.mobility_score ?? '—'],
                  ['ECG segment', `${c.vitals.ecg_segment?.samples?.length ?? 0} samples`],
                ].map(([k, v]) => (
                  <div key={k}><div className="text-[11px] uppercase tracking-wide text-fg-3">{k}</div><div className="font-medium text-fg">{v}</div></div>
                ))}
              </div>
            </Card>
          )}

          <Card title="Lab results" subtitle="Enzymes and biomarkers carry their reference range (Section 3.1a). Genetics use ClinVar autocomplete.">
            <LabsForm caseId={id} initial={c.labs} onSaved={(updated) => setC(updated)} />
          </Card>
        </>
      )}
    </div>
  );
}
