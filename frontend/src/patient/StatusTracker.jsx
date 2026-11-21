// A friendly horizontal progress tracker for one case. No risk information —
// Section 6.1 forbids any score, gauge or probability on the patient dashboard.
import { STEPS, stepIndex, isRejected } from './status.js';

export default function StatusTracker({ state }) {
  const current = stepIndex(state);
  const rejected = isRejected(state);

  return (
    <div>
      {rejected && (
        <p className="mb-4 rounded-lg border border-warn-line bg-warn-bg px-4 py-3 text-sm text-warn-fg">
          <span className="font-semibold">The lab needs a new sample. </span>
          Please arrange another visit so your samples can be collected again.
        </p>
      )}
      <ol className="flex flex-col gap-0 sm:flex-row sm:gap-0">
        {STEPS.map((step, i) => {
          const done = i < current;
          const active = i === current && !rejected;
          const state_ =
            active ? 'active' : done ? 'done' : rejected && i <= current ? 'done' : 'todo';
          return (
            <li key={step.key} className="relative flex-1 sm:text-center">
              <div className="flex items-center gap-3 sm:flex-col sm:gap-2">
                <span
                  className={
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ring-2 ' +
                    (state_ === 'active'
                      ? 'bg-accent-solid text-on-primary ring-accent-solid'
                      : state_ === 'done'
                        ? 'bg-ok-solid text-on-primary ring-ok-solid'
                        : 'bg-surface text-fg-3 ring-line')
                  }
                  aria-hidden
                >
                  {state_ === 'done' ? '✓' : i + 1}
                </span>
                <div className="pb-4 sm:pb-0">
                  <p className={'text-sm font-medium ' + (state_ === 'todo' ? 'text-fg-3' : 'text-fg')}>{step.title}</p>
                  {active && <p className="mt-0.5 max-w-[14rem] text-xs text-fg-3">{step.blurb}</p>}
                </div>
              </div>
              {i < STEPS.length - 1 && (
                <span
                  className={'absolute left-4 top-8 h-full w-0.5 sm:left-auto sm:top-4 sm:h-0.5 sm:w-full sm:translate-x-1/2 ' + (i < current ? 'bg-ok-solid' : 'bg-line')}
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
