// Section 6.3 actions. Buttons follow the case's allowed transitions, and every
// state change asks for confirmation first.
import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { release, transition } from '../data/doctorStore.js';
import { downloadReport } from '../lib/reportPdf.js';

const ACTIONS = {
  report: {
    label: 'Generate report (PDF)',
    title: 'Sign off and generate the report?',
    body: 'The case moves to REPORTED and the PDF downloads. You can then release results to the patient.',
    confirm: 'Sign off and download',
  },
  refer: {
    label: 'Refer to specialist',
    title: 'Refer this case to a metabolic specialist?',
    body: 'The case moves to REFERRED and leaves your worklist.',
    confirm: 'Refer',
  },
  moreTests: {
    label: 'Request more tests',
    title: 'Send the case back to the lab?',
    body: 'The case returns to LAB_PENDING. It is scored again when the lab resubmits.',
    confirm: 'Send to lab',
    reason: 'Which tests do you need? (shown to the lab)',
  },
  release: {
    label: 'Release results to patient',
    title: 'Release results to the patient?',
    body: 'The patient sees your note and that the review is complete. They never see risk scores, probabilities or charts.',
    confirm: 'Release',
    reason: 'Note for the patient',
  },
};

export default function CaseActions({ c }) {
  const [open, setOpen] = useState(null);
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const can = (to) => c.allowed_transitions.includes(to);

  const buttons = [
    { key: 'report', enabled: can('REPORTED') || c.state === 'REPORTED', primary: true },
    { key: 'refer', enabled: can('REFERRED') },
    { key: 'moreTests', enabled: can('LAB_PENDING') },
    { key: 'release', enabled: c.state === 'REPORTED' && !c.release },
  ];

  function start(key) {
    setError(null);
    setText('');
    // Re-downloading a signed-off report needs no confirmation.
    if (key === 'report' && c.state === 'REPORTED') return downloadReport(c);
    setOpen(key);
  }

  async function confirm() {
    setBusy(true);
    try {
      if (open === 'report') {
        const updated = await transition(c.id, 'REPORTED');
        downloadReport(updated);
      } else if (open === 'refer') await transition(c.id, 'REFERRED');
      else if (open === 'moreTests') {
        if (!text.trim()) return setError('Say which tests you need.');
        await transition(c.id, 'LAB_PENDING', text.trim());
      } else if (open === 'release') await release(c.id, text.trim());
      setOpen(null);
    } catch (e) {
      setError(e.body?.message || e.message);
    } finally {
      setBusy(false);
    }
  }

  const a = open && ACTIONS[open];

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {buttons.map(({ key, enabled, primary }) => (
          <button
            key={key}
            disabled={!enabled}
            onClick={() => start(key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
              primary ? 'bg-primary text-on-primary hover:bg-primary-hover' : 'bg-surface text-fg ring-1 ring-line-strong hover:bg-subtle'
            }`}
          >
            {key === 'report' && c.state === 'REPORTED' ? 'Download report (PDF)' : ACTIONS[key].label}
          </button>
        ))}
      </div>

      <AnimatePresence>
        {a && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-primary/40 p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(null)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="action-title"
              className="w-full max-w-md rounded-xl bg-surface p-5 shadow-xl"
              initial={{ y: 12, scale: 0.98 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: 12, scale: 0.98 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id="action-title" className="font-semibold text-fg">{a.title}</h2>
              <p className="mt-1 text-sm text-fg-2">{a.body}</p>
              {a.reason && (
                <label className="mt-4 block text-sm">
                  <span className="text-fg-2">{a.reason}</span>
                  <textarea
                    autoFocus
                    rows={3}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    className="mt-1 w-full rounded-md border border-line-strong p-2 text-sm focus:border-line-strong focus:outline-none"
                  />
                </label>
              )}
              {error && <p className="mt-2 text-sm text-danger-fg">{error}</p>}
              <div className="mt-5 flex justify-end gap-2">
                <button onClick={() => setOpen(null)} className="rounded-md px-3 py-1.5 text-sm text-fg-2 ring-1 ring-line-strong hover:bg-subtle">
                  Cancel
                </button>
                <button onClick={confirm} disabled={busy} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-on-primary hover:bg-primary-hover disabled:opacity-40">
                  {a.confirm}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
