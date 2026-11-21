import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, onToken } from './api.js';
import { resetLive } from '../data/doctorStore.js';
import { useDemo } from '../demo/mode.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  const demo = useDemo();

  // Restore the live session from its refresh cookie. In demo mode we do nothing: no
  // request, and `user` is left exactly as it is, so turning demo off returns to the
  // same live session. (Loading the page already in demo mode restores it on exit.)
  useEffect(() => {
    if (demo) {
      setReady(true);
      return;
    }
    if (user) return;
    api.tryResume().then((u) => {
      setUser(u);
      setReady(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);

  // When the token is dropped because a session died mid-use (api.js clears it
  // after a failed silent refresh), sign the user out here too, so the app falls
  // back to the sign-in page rather than a screen stuck on "unauthenticated".
  useEffect(() => onToken((t) => {
    if (t === null) setUser(null);
  }), []);

  const login = useCallback(async (email, password) => {
    setUser(await api.login(email, password));
  }, []);

  // Patient self-enrolment: the new account is signed in straight away.
  const registerPatient = useCallback(async (details) => {
    setUser(await api.registerPatient(details));
  }, []);

  // One login, several dashboards. Switching re-issues the access token for the
  // chosen role; the server refuses any role the account does not hold.
  const switchRole = useCallback(async (role) => {
    const u = await api.switchRole(role);
    resetLive(); // the doctor cache belongs to the role that fetched it
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    resetLive();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, ready, login, logout, registerPatient, switchRole }),
    [user, ready, login, logout, registerPatient, switchRole],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
