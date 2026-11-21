// App shell: one sign-in for the whole system, a product navbar, and three
// dashboards the signed-in account switches between (Section 5 roles are still
// enforced server-side per ACTIVE role — switching never widens what you see).
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import DoctorCaseDetail from './pages/DoctorCaseDetail.jsx';
import DoctorWorklist from './pages/DoctorWorklist.jsx';
import LabCaseWorkspace from './pages/LabCaseWorkspace.jsx';
import LabWorklist from './pages/LabWorklist.jsx';
import Login from './pages/Login.jsx';
import PatientCaseView from './pages/PatientCaseView.jsx';
import PatientHome from './pages/PatientHome.jsx';
import PatientProfile from './pages/PatientProfile.jsx';
import SymptomQuestionnaire from './pages/SymptomQuestionnaire.jsx';
import PageTransition from './components/PageTransition.jsx';
import { PageSkeleton } from './components/Skeleton.jsx';
import ThemeToggle from './components/ThemeToggle.jsx';
import { setDemo, useDemo } from './demo/mode.js';
import * as demoStore from './demo/store.js';
import { AuthProvider, useAuth } from './lib/useAuth.jsx';
import { ThemeProvider } from './lib/theme.jsx';

const AREAS = [
  { key: 'patient', label: 'Patient', path: '/patient', blurb: 'Report symptoms and follow each check' },
  { key: 'lab', label: 'Laboratory', path: '/lab', blurb: 'Capture vitals and enter results' },
  { key: 'doctor', label: 'Clinician', path: '/doctor', blurb: 'Review scored cases and decide' },
];
const AREA_KEYS = AREAS.map((a) => a.key);

/* ───────────────────────── role areas ───────────────────────── */

// Guards one dashboard. The navbar switches role on click, so this only matters
// for a deep link or a reload: if the account holds the role, move to it rather
// than showing a dead end.
function RoleArea({ roles, label, children }) {
  const demo = useDemo();
  useSyncExternalStore(demoStore.subscribe, demoStore.getVersion);
  const { user, switchRole } = useAuth();
  const [switching, setSwitching] = useState(false);
  const canSwitch = !demo && user && !roles.includes(user.role) && roles.some((r) => user.roles?.includes(r));

  useEffect(() => {
    if (!canSwitch || switching) return;
    setSwitching(true);
    switchRole(roles.find((r) => user.roles.includes(r))).finally(() => setSwitching(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSwitch]);

  if (demo) return children;
  if (canSwitch || switching) return <PageSkeleton rows={2} />;
  if (!roles.includes(user.role)) {
    return (
      <Callout tone="warn" title={`This dashboard is for ${label}.`}>
        You are signed in as <strong>{user.role}</strong>, and this account cannot act as {label}. Sign in with an
        account that can, or use the project login that holds all three roles.
      </Callout>
    );
  }
  return children;
}

function Callout({ tone = 'warn', title, children }) {
  const tones = {
    warn: 'border-warn-line bg-warn-bg text-warn-fg',
    danger: 'border-danger-line bg-danger-bg text-danger-fg',
  };
  return (
    <div className={`rounded-xl border px-5 py-4 text-body ${tones[tone]}`}>
      <p className="font-semibold">{title}</p>
      <p className="mt-1 opacity-90">{children}</p>
    </div>
  );
}

const DoctorGate = () => (
  <RoleArea roles={['doctor']} label="clinicians">
    <Outlet />
  </RoleArea>
);

const LabArea = () => (
  <RoleArea roles={['lab', 'admin']} label="laboratory staff">
    <Routes>
      <Route path="/" element={<LabWorklist />} />
      <Route path="/cases/:id" element={<LabCaseWorkspace />} />
      <Route path="*" element={<Navigate to="/lab" replace />} />
    </Routes>
  </RoleArea>
);

const PatientArea = () => (
  <RoleArea roles={['patient']} label="patients">
    <Routes>
      <Route path="/" element={<PatientHome />} />
      <Route path="/profile" element={<PatientProfile />} />
      <Route path="/cases/:id" element={<PatientCaseView />} />
      <Route path="/cases/:id/questionnaire" element={<SymptomQuestionnaire />} />
      <Route path="*" element={<Navigate to="/patient" replace />} />
    </Routes>
  </RoleArea>
);

/* ───────────────────────── demo mode ───────────────────────── */

function useDemoSwitch() {
  const demo = useDemo();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const seg = pathname.split('/')[1];
  const area = AREA_KEYS.includes(seg) ? seg : 'patient';
  return {
    demo,
    toggle: () => {
      setDemo(!demo);
      nav(`/${area}`, { replace: true });
    },
  };
}

function DemoToggle() {
  const { demo, toggle } = useDemoSwitch();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={demo}
      onClick={toggle}
      title={demo ? 'Leave demo mode and return to live data' : 'Run the whole system on scripted demo data'}
      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-label font-semibold transition-colors ${
        demo ? 'border-warn-line bg-warn-bg text-warn-fg' : 'border-line bg-subtle text-fg-2 hover:border-line-strong hover:text-fg'
      }`}
    >
      <span className={`relative h-3.5 w-6 rounded-full transition-colors ${demo ? 'bg-warn-solid' : 'bg-line-strong'}`} aria-hidden>
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 500, damping: 34 }}
          className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-surface ${demo ? 'left-3' : 'left-0.5'}`}
        />
      </span>
      Demo
    </button>
  );
}

// Persistent and not dismissible: part of the shell, outside <Routes>, so it shows
// on every screen while demo mode is on. A clinician must never be able to mistake
// a demo result for a real one.
function DemoBanner() {
  const { demo, toggle } = useDemoSwitch();
  const { pathname } = useLocation();
  useSyncExternalStore(demoStore.subscribe, demoStore.getVersion);

  useEffect(() => {
    document.title = demo ? 'DEMO · LSD-CDSS' : 'LSD-CDSS';
  }, [demo]);

  const btn = 'rounded-md border border-warn-line px-2 py-0.5 font-semibold text-warn-fg transition-colors hover:bg-warn-line/30';
  return (
    <AnimatePresence initial={false}>
      {demo && (
        <motion.div
          role="status"
          aria-live="polite"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="sticky top-0 z-50 overflow-hidden border-b-2 border-warn-solid bg-warn-bg text-warn-fg"
        >
          <div className="mx-auto flex max-w-[84rem] flex-wrap items-center gap-x-4 gap-y-1 px-5 py-1.5 text-label sm:px-8">
            <span className="rounded bg-warn-fg px-1.5 py-0.5 font-bold tracking-wide text-warn-bg">DEMO MODE</span>
            <span className="font-semibold">Not real patient data.</span>
            <span className="hidden sm:inline">Scripted cases · nothing is saved or sent</span>
            <span className="ml-auto flex flex-wrap items-center gap-2">
              {pathname.startsWith('/patient') && (
                <label className="flex items-center gap-1.5">
                  Viewing as
                  <select
                    value={demoStore.getPersona()}
                    onChange={(e) => demoStore.setPersona(e.target.value)}
                    className="rounded-md border border-warn-line bg-surface px-1.5 py-0.5 text-fg"
                  >
                    {demoStore.patientsList().map((p) => (
                      <option key={p.key} value={p.key}>{p.name}</option>
                    ))}
                  </select>
                </label>
              )}
              <button type="button" onClick={demoStore.reset} className={btn}>Reset demo</button>
              <button type="button" onClick={toggle} className={btn}>Exit demo</button>
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ───────────────────────── navbar ───────────────────────── */

function BrandMark() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-primary text-on-primary" aria-hidden>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12h4l2 5 4-12 2 7h6" />
        </svg>
      </span>
      <span className="leading-tight">
        <span className="block text-body font-semibold tracking-tight text-fg">LSD-CDSS</span>
        <span className="block text-micro text-fg-3">Screening support</span>
      </span>
    </span>
  );
}

// The three dashboards. A click switches the session's active role when the
// account holds it, so there is one sign-in rather than three.
function AreaNav() {
  const demo = useDemo();
  const { user, switchRole } = useAuth();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const [pending, setPending] = useState(null);
  const current = pathname.split('/')[1];

  const go = useCallback(
    async (area) => {
      if (demo || user?.role === area.key) {
        nav(area.path);
        return;
      }
      setPending(area.key);
      try {
        await switchRole(area.key);
        nav(area.path);
      } finally {
        setPending(null);
      }
    },
    [demo, user, switchRole, nav],
  );

  if (!demo && !user) return null;

  return (
    <nav aria-label="Dashboards" className="flex items-center gap-1 rounded-xl bg-muted/70 p-1">
      {AREAS.map((area) => {
        const held = demo || user.roles?.includes(area.key);
        const active = current === area.key;
        return (
          <button
            key={area.key}
            type="button"
            disabled={!held || pending === area.key}
            onClick={() => go(area)}
            aria-current={active ? 'page' : undefined}
            title={held ? area.blurb : `This account cannot act as ${area.label.toLowerCase()}`}
            className={`relative rounded-lg px-3 py-1.5 text-body font-medium transition-colors ${
              active ? 'text-fg' : 'text-fg-3 hover:text-fg-2'
            } ${held ? '' : 'cursor-not-allowed opacity-40'}`}
          >
            {active && (
              <motion.span
                layoutId="area-pill"
                transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                className="absolute inset-0 rounded-lg bg-surface shadow-card"
              />
            )}
            <span className="relative z-10">{pending === area.key ? 'Switching…' : area.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

const ROLE_LABEL = { patient: 'Patient', lab: 'Laboratory', doctor: 'Clinician', admin: 'Admin' };

function AccountMenu() {
  const demo = useDemo();
  const { user, logout } = useAuth();
  useSyncExternalStore(demoStore.subscribe, demoStore.getVersion);
  const [open, setOpen] = useState(false);

  if (demo) {
    const seg = window.location.pathname.split('/')[1];
    const persona = demoStore.personaUser(AREA_KEYS.includes(seg) ? seg : 'patient');
    return <span className="hidden text-label text-fg-3 sm:inline">Demo · {persona.name}</span>;
  }
  if (!user) return null;

  const initials = user.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-lg border border-line bg-subtle py-1 pl-1 pr-2.5 transition-colors hover:border-line-strong"
      >
        <span className="grid h-6 w-6 place-items-center rounded-md bg-accent-solid text-micro font-bold text-on-primary">{initials}</span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-label font-medium text-fg">{user.name}</span>
          <span className="block text-micro text-fg-3">{ROLE_LABEL[user.role] ?? user.role}</span>
        </span>
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-fg-3" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <>
            <button type="button" className="fixed inset-0 z-40 cursor-default" aria-hidden onClick={() => setOpen(false)} />
            <motion.div
              role="menu"
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-line bg-surface shadow-pop"
            >
              <div className="border-b border-line px-4 py-3">
                <p className="text-body font-medium text-fg">{user.name}</p>
                <p className="mt-0.5 text-micro text-fg-3">
                  {(user.roles ?? [user.role]).map((r) => ROLE_LABEL[r] ?? r).join(' · ')}
                  {user.facility ? ` · ${user.facility}` : ''}
                </p>
              </div>
              {user.role === 'patient' && (
                <NavLink
                  to="/patient/profile"
                  onClick={() => setOpen(false)}
                  className="block px-4 py-2.5 text-body text-fg-2 transition-colors hover:bg-subtle hover:text-fg"
                >
                  Your profile
                </NavLink>
              )}
              <button
                type="button"
                onClick={logout}
                className="block w-full px-4 py-2.5 text-left text-body text-danger-fg transition-colors hover:bg-danger-bg"
              >
                Sign out
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function Navbar() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[84rem] items-center gap-4 px-5 sm:px-8">
        <BrandMark />
        <div className="ml-2 hidden md:block">
          <AreaNav />
        </div>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <DemoToggle />
          <ThemeToggle />
          <AccountMenu />
        </div>
      </div>
      <div className="border-t border-line px-5 pb-2.5 pt-2 md:hidden">
        <AreaNav />
      </div>
    </header>
  );
}

/* ───────────────────────── app ───────────────────────── */

export default function App() {
  return (
    <ThemeProvider>
      <MotionConfig reducedMotion="user">
        <AuthProvider>
          <AppShell />
        </AuthProvider>
      </MotionConfig>
    </ThemeProvider>
  );
}

function AppShell() {
  const demo = useDemo();
  const { user, ready } = useAuth();
  const { pathname } = useLocation();
  const signedOut = !demo && ready && !user;

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-fg">
      <DemoBanner />
      <Navbar />
      {/* Keyed on the demo flag so every page remounts and refetches from the right source. */}
      <main key={demo ? 'demo' : 'live'} className="mx-auto w-full max-w-[84rem] flex-1 px-5 py-8 sm:px-8">
        {!demo && !ready ? (
          <PageSkeleton rows={2} />
        ) : signedOut ? (
          <Login />
        ) : (
          <PageTransition key={pathname}>
            <Routes>
              <Route path="/" element={<Navigate to="/patient" replace />} />
              <Route element={<DoctorGate />}>
                <Route path="/doctor" element={<DoctorWorklist />} />
                <Route path="/doctor/cases/:id" element={<DoctorCaseDetail />} />
              </Route>
              <Route path="/lab/*" element={<LabArea />} />
              <Route path="/patient/*" element={<PatientArea />} />
              <Route path="*" element={<Navigate to="/patient" replace />} />
            </Routes>
          </PageTransition>
        )}
      </main>
      <footer className="border-t border-line px-5 py-5 sm:px-8">
        <p className="mx-auto max-w-[84rem] text-micro text-fg-3">
          Screening aid only — not a diagnosis. Every result must be reviewed by a qualified clinician and confirmed by
          laboratory testing.
        </p>
      </footer>
    </div>
  );
}
