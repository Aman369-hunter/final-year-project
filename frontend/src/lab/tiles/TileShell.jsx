// Shared chrome for every sensor tile, so the five read as one instrument panel:
// the same radius, border, elevation, header, type scale and status language.
// Three signal states (no-signal / poor-signal / live); when the stream is frozen
// (disconnect mid-session) the tile dims and shows "Signal lost" without zeroing values.

const QUALITY = {
  'no-signal': { dot: 'bg-line-strong', text: 'No signal', cls: 'text-fg-3' },
  'poor-signal': { dot: 'bg-warn-solid', text: 'Poor signal', cls: 'text-warn-fg' },
  live: { dot: 'bg-ok-solid', text: 'Live', cls: 'text-ok-fg' },
};

export function TileShell({ title, sensor, quality = 'no-signal', frozen = false, children, footer, className = '' }) {
  const q = QUALITY[quality] ?? QUALITY['no-signal'];
  return (
    <div className={`card relative flex flex-col p-4 ${className}`}>
      <header className="mb-3 flex items-start justify-between">
        <div>
          <h3 className="text-body font-semibold text-fg">{title}</h3>
          <p className="text-micro text-fg-3">{sensor}</p>
        </div>
        <span className="flex items-center gap-1.5 text-micro font-medium">
          <span className={`h-2 w-2 rounded-full ${q.dot} ${quality === 'live' ? 'animate-pulse motion-reduce:animate-none' : ''}`} />
          <span className={q.cls}>{q.text}</span>
        </span>
      </header>
      <div className={`relative flex-1 transition-opacity ${frozen ? 'opacity-40' : ''}`}>{children}</div>
      {footer && <div className="mt-2 text-micro text-fg-3">{footer}</div>}
      {frozen && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-surface/60 backdrop-blur-[1px]">
          <span className="rounded-md bg-primary px-3 py-1 text-label font-semibold text-on-primary">Signal lost</span>
        </div>
      )}
    </div>
  );
}

// Shown over an idle canvas when the sensor is absent from the stream: never stale numbers or zeros.
export function NoSignal({ label = 'Waiting for sensor…' }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-body text-fg-3">{label}</div>
  );
}
