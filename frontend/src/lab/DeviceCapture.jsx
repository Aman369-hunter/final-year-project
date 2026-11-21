// The hardware surface of the lab dashboard (Section 6.2, STEP 2 + 3).
// Owns the SerialSource and VitalsMonitor, shows the 5 tiles, the explicit
// connection state, and the recording controls. Works identically with the
// replay source (no hardware) and a real ESP32 — the tiles never know which.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDemo } from '../demo/mode.js';
import { ReplaySource } from './serial/ReplaySource.js';
import { WebSerialSource, webSerialSupported } from './serial/WebSerialSource.js';
import { HttpSource, normaliseDeviceUrl } from './serial/HttpSource.js';
import { VitalsMonitor } from './VitalsMonitor.js';
import { useVitals } from './useMonitor.js';
import EcgTile from './tiles/EcgTile.jsx';
import HeartRateTile from './tiles/HeartRateTile.jsx';
import MotionTile from './tiles/MotionTile.jsx';
import SpO2Tile from './tiles/SpO2Tile.jsx';
import TemperatureTile from './tiles/TemperatureTile.jsx';

const CONNECTION = {
  disconnected: { label: 'Disconnected', cls: 'bg-muted text-fg-2' },
  connecting: { label: 'Connecting…', cls: 'bg-warn-bg text-warn-fg' },
  streaming: { label: 'Streaming', cls: 'bg-ok-bg text-ok-fg' },
  error: { label: 'Connection error', cls: 'bg-danger-bg text-danger-fg' },
  ended: { label: 'Stream ended', cls: 'bg-muted text-fg-2' },
};

// Remembered between visits so the lab does not retype the device address
// every session. Per-browser convenience only.
const DEVICE_URL_KEY = 'lsd.lab.deviceUrl';

// Fallback for the first visit on a fresh browser: set VITE_DEVICE_URL in
// frontend/.env to this bench's ESP32 address so the field arrives filled in.
// A value the lab typed before always wins over it.
const DEVICE_URL_DEFAULT = import.meta.env.VITE_DEVICE_URL ?? '';

function loadDeviceUrl() {
  try {
    return localStorage.getItem(DEVICE_URL_KEY) || DEVICE_URL_DEFAULT;
  } catch {
    return DEVICE_URL_DEFAULT;
  }
}

export default function DeviceCapture({ onSave, disabled }) {
  const demo = useDemo();
  const [pickedKind, setSourceKind] = useState('replay'); // 'replay' | 'webserial' | 'http'
  // Demo mode always uses the scripted replay stream: never a real device.
  const sourceKind = demo ? 'replay' : pickedKind;
  const [deviceUrl, setDeviceUrl] = useState(loadDeviceUrl);
  const [monitor, setMonitor] = useState(null);
  const sourceRef = useRef(null);
  const urlRef = useRef(deviceUrl);
  urlRef.current = deviceUrl;

  // Build a fresh monitor+source when the kind changes or on mount.
  useEffect(() => {
    let source;
    if (sourceKind === 'webserial') source = new WebSerialSource();
    else if (sourceKind === 'http') source = new HttpSource({ url: urlRef.current });
    else source = new ReplaySource({ loop: true });

    const m = new VitalsMonitor(source);
    sourceRef.current = source;
    setMonitor(m);
    return () => {
      source.stop?.();
      m.destroy();
    };
  }, [sourceKind]);

  if (!monitor) return null;
  return (
    <CaptureInner
      monitor={monitor}
      source={sourceRef.current}
      sourceKind={sourceKind}
      setSourceKind={setSourceKind}
      deviceUrl={deviceUrl}
      setDeviceUrl={setDeviceUrl}
      onSave={onSave}
      disabled={disabled}
    />
  );
}

function CaptureInner({ monitor, source, sourceKind, setSourceKind, deviceUrl, setDeviceUrl, onSave, disabled }) {
  const demo = useDemo();
  const v = useVitals(monitor);
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState(null); // summary awaiting save/discard
  const [connectError, setConnectError] = useState(null);
  const conn = CONNECTION[v.connection] ?? CONNECTION.disconnected;
  const streaming = v.connection === 'streaming';

  async function connect() {
    setConnectError(null);
    if (sourceKind === 'http') {
      const resolved = normaliseDeviceUrl(deviceUrl);
      if (!resolved) {
        setConnectError('Enter the ESP32 address, e.g. 192.168.82.128');
        return;
      }
      source.url = resolved;
      try {
        localStorage.setItem(DEVICE_URL_KEY, deviceUrl.trim());
      } catch {
        /* private window: not worth failing the connection over */
      }
    }
    try {
      await source.start();
    } catch (err) {
      // Network and CORS failures are indistinguishable in the browser, so
      // the message has to cover both rather than guess.
      setConnectError(err?.message ?? 'Could not connect to the device.');
    }
  }

  function start() {
    monitor.startRecording();
    setRecording(true);
    setPending(null);
  }

  function stop() {
    const summary = monitor.stopRecording();
    setRecording(false);
    setPending(summary);
  }

  function discard() {
    monitor.cancelRecording();
    setRecording(false);
    setPending(null);
  }

  function save() {
    onSave?.(pending);
    setPending(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${conn.cls}`}>{conn.label}</span>
          {v.connection === 'streaming' && (
            <span className="text-[11px] text-fg-3">
              {demo
                ? 'Scripted demo stream (not a real device)'
                : sourceKind === 'replay'
                  ? 'Replaying recorded session (no hardware)'
                  : sourceKind === 'http'
                    ? 'ESP32 over WiFi — polled once a second, about 1 s behind live'
                    : 'ESP32 via Web Serial'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={sourceKind}
            onChange={(e) => setSourceKind(e.target.value)}
            disabled={streaming || recording || demo}
            className="rounded-md border border-line-strong bg-surface px-2 py-1 text-xs text-fg disabled:opacity-50"
          >
            <option value="replay">{demo ? 'Scripted stream (demo mode)' : 'Replay fixture (no device)'}</option>
            <option value="webserial" disabled={!webSerialSupported()}>
              ESP32 (Web Serial){webSerialSupported() ? '' : ' — unsupported browser'}
            </option>
            <option value="http">ESP32 (WiFi)</option>
          </select>
          {sourceKind === 'http' && !streaming && (
            <input
              value={deviceUrl}
              onChange={(e) => setDeviceUrl(e.target.value)}
              placeholder="192.168.82.128"
              spellCheck={false}
              className="w-40 rounded-md border border-line-strong bg-surface px-2 py-1 text-xs text-fg placeholder:text-fg-3"
              aria-label="ESP32 address"
            />
          )}
          {!streaming ? (
            <button onClick={connect} disabled={disabled} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-on-primary hover:bg-primary-hover disabled:opacity-40">
              {sourceKind === 'webserial' ? 'Connect device' : 'Start stream'}
            </button>
          ) : (
            <button onClick={() => source.stop()} className="rounded-md px-3 py-1.5 text-sm ring-1 ring-line-strong hover:bg-subtle">
              Disconnect
            </button>
          )}
          {sourceKind === 'replay' && streaming && (
            <button onClick={() => source.simulateDisconnect()} className="rounded-md px-2 py-1.5 text-[11px] text-fg-3 ring-1 ring-line hover:bg-subtle" title="Demo: simulate a mid-session disconnect">
              Simulate dropout
            </button>
          )}
        </div>
      </div>

      {connectError && (
        <p className="rounded-md bg-danger-bg px-3 py-2 text-xs text-danger-fg" role="alert">
          {connectError}
        </p>
      )}

      {/* 5-tile grid above the recording controls */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <HeartRateTile monitor={monitor} />
        <SpO2Tile monitor={monitor} />
        <TemperatureTile monitor={monitor} />
        <MotionTile monitor={monitor} />
        <div className="md:col-span-2">
          <EcgTile monitor={monitor} />
        </div>
      </div>

      {/* Recording controls (STEP 3) */}
      <div className="rounded-xl border border-line bg-subtle p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-fg">Session recording</h3>
            <p className="text-[11px] text-fg-3">
              {recording ? 'Recording… capturing medians and a 10 s ECG segment.' : pending ? 'Review the session summary, then save or re-record.' : 'Attach the sensors, then start recording against this case.'}
            </p>
          </div>
          <div className="flex gap-2">
            {!recording && !pending && (
              <button onClick={start} disabled={!streaming} className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-on-primary hover:bg-rose-500 disabled:opacity-40">
                ● Start recording
              </button>
            )}
            {recording && (
              <>
                <button onClick={stop} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-on-primary hover:bg-primary-hover">
                  ■ Stop and review
                </button>
                <button onClick={discard} className="rounded-md px-3 py-1.5 text-sm ring-1 ring-line-strong hover:bg-surface">
                  Discard
                </button>
              </>
            )}
          </div>
        </div>

        {pending && <SummaryReview summary={pending} onSave={save} onDiscard={discard} disabled={disabled} />}
      </div>
    </div>
  );
}

function SummaryReview({ summary, onSave, onDiscard, disabled }) {
  const rows = [
    ['Median HR', summary.heart_rate_bpm, 'bpm'],
    ['Median SpO₂', summary.spo2_pct, '%'],
    ['Temperature', summary.temperature_c, '°C'],
    ['Respiratory rate', summary.respiratory_rate_bpm, '/min'],
    ['Arrhythmia flag', summary.ecg.arrhythmia_flag ? 'yes' : 'no', ''],
    ['Tremor index', summary.activity.tremor_index, ''],
    ['Mobility score', summary.activity.mobility_score, ''],
    ['ECG segment', summary.ecg_segment.samples.length, `samples @ ${summary.ecg_segment.sample_rate_hz} Hz`],
  ];
  return (
    <div className="mt-4 rounded-lg border border-line bg-surface p-3">
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-4">
        {rows.map(([k, val, unit]) => (
          <div key={k}>
            <div className="text-[11px] uppercase tracking-wide text-fg-3">{k}</div>
            <div className="text-sm font-medium tabular-nums text-fg">{val ?? '—'} <span className="text-[11px] font-normal text-fg-3">{unit}</span></div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button onClick={onDiscard} className="rounded-md px-3 py-1.5 text-sm ring-1 ring-line-strong hover:bg-subtle">
          Discard and re-record
        </button>
        <button onClick={onSave} disabled={disabled} className="rounded-md bg-ok-solid px-3 py-1.5 text-sm font-medium text-on-primary hover:brightness-110 disabled:opacity-40">
          Save to case
        </button>
      </div>
    </div>
  );
}
