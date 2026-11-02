import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { useData } from "./lib/data";
import { cls } from "./lib/util";
import { Button, Logo } from "./components/ui";
import { fmtTime } from "./shared/time";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Machines from "./pages/Machines";
import LogSheets from "./pages/LogSheets";
import Weighbridge from "./pages/Weighbridge";
import Yards from "./pages/Yards";
import Gate from "./pages/Gate";
import Crew from "./pages/Crew";
import Jobs from "./pages/Jobs";
import Setup from "./pages/Setup";
import Users from "./pages/Users";
import MyVehicle from "./pages/MyVehicle";
import MyMachines from "./pages/MyMachines";

const MGMT = ["Owner", "Manager", "Supervisor"];
const PAGES = [
  { path: "/dashboard", label: "Dashboard", roles: ["Owner", "Manager"], el: <Dashboard /> },
  { path: "/machines", label: "Machines", roles: MGMT, el: <Machines /> },
  { path: "/log-sheets", label: "Log sheets", roles: MGMT, el: <LogSheets /> },
  { path: "/weighbridge", label: "Weighbridge", roles: ["Weighbridge", "Owner", "Manager"], el: <Weighbridge /> },
  { path: "/yards", label: "Yards & batches", roles: MGMT, el: <Yards /> },
  { path: "/gate", label: "Gate register", roles: ["Security", ...MGMT], el: <Gate /> },
  { path: "/crew", label: "Shift & crew", roles: MGMT, el: <Crew /> },
  { path: "/jobs", label: "Maintenance jobs", roles: ["Fitter", ...MGMT], el: <Jobs /> },
  { path: "/my-machines", label: "My machines", roles: ["Operator"], el: <MyMachines /> },
  { path: "/my-vehicle", label: "My vehicle", roles: ["Driver"], el: <MyVehicle /> },
  { path: "/users", label: "Users & roles", roles: ["Owner", "Manager"], el: <Users /> },
  { path: "/setup", label: "Setup lists", roles: ["Owner", "Manager"], el: <Setup /> },
];

export default function App() {
  const { session, signOut } = useAuth();
  const { loadedAt, loading, error, reload } = useData();
  if (!session) return <Login />;

  const allowed = PAGES.filter((p) => p.roles.some((r) => session.roles.includes(r)));

  return (
    <div className="flex min-h-screen bg-page text-slate-900">
      <aside className="no-print sticky top-0 flex h-screen w-60 shrink-0 flex-col bg-brand-950 p-4 text-brand-50">
        <div className="mb-6 flex items-center gap-3">
          <Logo />
          <div>
            <div className="font-display text-2xl font-bold leading-none">BAKAS FACTORY</div>
            <div className="mt-1 text-[11px] text-brand-300">Bakas Renewable Energy · Sarlahi</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto">
          {allowed.map((p) => (
            <NavLink
              key={p.path}
              to={p.path}
              className={({ isActive }) => cls("block rounded-lg px-3 py-2 text-sm font-medium", isActive ? "bg-brand-700 text-white" : "text-brand-100 hover:bg-brand-900")}
            >
              {p.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-4 border-t border-brand-800 pt-4 text-sm">
          <div className="font-semibold">{session.person.full_name}</div>
          <div className="mb-3 text-xs text-brand-300">{session.roles.join(", ")}</div>
          <Button kind="ghost" small onClick={signOut}><span className="text-brand-100">Sign out</span></Button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <div className="no-print flex items-center justify-end gap-3 border-b border-slate-200 bg-white px-6 py-2 text-xs text-slate-500">
          {error ? <span className="font-semibold text-red-700">{error}</span> : null}
          <span>{loadedAt ? `Updated ${fmtTime(loadedAt.toISOString())}` : "Loading..."}</span>
          <Button kind="ghost" small onClick={reload} disabled={loading}>{loading ? "Refreshing..." : "Refresh"}</Button>
        </div>
        <main className="p-6">
          {allowed.length === 0 ? (
            <p className="text-slate-600">Your role has no laptop screens yet. Use the phone app.</p>
          ) : (
            <Routes>
              {allowed.map((p) => <Route key={p.path} path={p.path} element={p.el} />)}
              <Route path="*" element={<Navigate to={allowed[0].path} replace />} />
            </Routes>
          )}
        </main>
      </div>
    </div>
  );
}