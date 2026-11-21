// Light / Dark / System segmented control. A radiogroup so it is one tab stop
// with arrow-key navigation, and each option has a text label for screen readers.
import { useRef } from 'react';
import { MODES, useTheme } from '../lib/theme.jsx';

const ICON = {
  light: <path d="M12 4V2m0 20v-2m8-8h2M2 12h2m13.66-5.66 1.41-1.41M4.93 19.07l1.41-1.41m0-11.32L4.93 4.93m14.14 14.14-1.41-1.41M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z" />,
  dark: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />,
  system: <path d="M4 5h16v11H4zM9 20h6M12 16v4" />,
};
const LABEL = { light: 'Light', dark: 'Dark', system: 'System' };

export default function ThemeToggle() {
  const { mode, setMode } = useTheme();
  const ref = useRef(null);

  const onKey = (e) => {
    const i = MODES.indexOf(mode);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') setMode(MODES[(i + 1) % MODES.length]);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') setMode(MODES[(i + MODES.length - 1) % MODES.length]);
    else return;
    e.preventDefault();
    requestAnimationFrame(() => ref.current?.querySelector('[aria-checked="true"]')?.focus());
  };

  return (
    <div ref={ref} role="radiogroup" aria-label="Colour theme" onKeyDown={onKey} className="flex items-center rounded-lg border border-line bg-subtle p-0.5">
      {MODES.map((m) => {
        const on = m === mode;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={LABEL[m]}
            title={LABEL[m]}
            tabIndex={on ? 0 : -1}
            onClick={() => setMode(m)}
            className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${on ? 'bg-surface text-fg shadow-card' : 'text-fg-3 hover:text-fg'}`}
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {ICON[m]}
            </svg>
          </button>
        );
      })}
    </div>
  );
}
