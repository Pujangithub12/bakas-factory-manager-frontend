import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setUnauthorizedHandler } from "./api";

export type Session = { person: { id: string; full_name: string }; roles: string[] };
type Ctx = {
  session: Session | null;
  setRoles: (roles: string[]) => void;
  signIn: (personId: string, pin: string) => Promise<void>;
  /** Sign in as a role with a PIN: the person is the one holding that role whose PIN it is. */
  signInRole: (role: string, pin: string) => Promise<void>;
  /** First run: create the one Owner and sign in. */
  setupOwner: (fullName: string, pin: string, email?: string) => Promise<void>;
  signOut: () => void;
};

const AuthCtx = createContext<Ctx>(null as unknown as Ctx);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => {
    try {
      const raw = localStorage.getItem("session");
      return raw && localStorage.getItem("token") ? (JSON.parse(raw) as Session) : null;
    } catch {
      return null;
    }
  });

  const signOut = useCallback(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("session");
    setSession(null);
  }, []);

  useEffect(() => setUnauthorizedHandler(signOut), [signOut]);

  type Login = { token: string; person: Session["person"]; roles: string[] };
  const start = useCallback((r: Login) => {
    const s = { person: r.person, roles: r.roles };
    localStorage.setItem("token", r.token);
    localStorage.setItem("session", JSON.stringify(s));
    setSession(s);
  }, []);
  const signIn = useCallback(async (personId: string, pin: string) => start(await api<Login>("/auth/login", { body: { person_id: personId, pin } })), [start]);
  const signInRole = useCallback(async (role: string, pin: string) => start(await api<Login>("/auth/login", { body: { role, pin } })), [start]);
  const setupOwner = useCallback(async (fullName: string, pin: string, email?: string) => start(await api<Login>("/auth/setup", { body: { full_name: fullName, pin, ...(email ? { email } : {}) } })), [start]);

  const setRoles = useCallback((roles: string[]) => {
    setSession((s) => {
      if (!s || s.roles.join() === roles.join()) return s;
      const next = { ...s, roles };
      localStorage.setItem("session", JSON.stringify(next));
      return next;
    });
  }, []);

  return <AuthCtx.Provider value={{ session, setRoles, signIn, signInRole, setupOwner, signOut }}>{children}</AuthCtx.Provider>;
}
