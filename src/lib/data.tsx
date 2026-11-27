import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import type { Data } from "../shared/types";

type Challan = { last: number | null; prefix: string | null };
type Ctx = {
  D: Data;
  loading: boolean;
  error: string | null;
  loadedAt: Date | null;
  challan: Challan;
  reload: () => Promise<void>;
  /** Make sure at least this many days of history are loaded. */
  needDays: (n: number) => void;
  /** How many days of history the last load brought. */
  loadedDays: number;
  /** Change the rows on screen straight away after a save, instead of loading everything again. */
  patch: (table: string, change: (rows: Data[string]) => Data[string]) => void;
};

const TABLES = [
  "person", "person_role", "operator_machine", "shift", "attendance", "attendance_mark", "shift_in_charge", "machine", "stop_reason", "log_field", "machine_run",
  "run_helper", "prestart_answer", "run_bypass", "downtime", "log_reading", "greasing_check", "bag_count", "maintenance_job", "material",
  "supplier", "buyer", "yard", "yard_batch", "weigh_ticket", "opening_stock",
  "vehicle", "driver_vehicle", "vehicle_session", "diesel_fill", "hour_meter_reading", "pm_task", "pm_done", "phone_screen", "visitor", "store_item", "store_movement",
  "purchase_request", "purchase_request_line", "power_reading", "lab_test", "sales_bill", "payment", "raw_price", "sale_price", "product_vat", "moisture_standard",
  "daily_wage", "nea_tariff", "setting",
];
const EMPTY: Data = Object.fromEntries(TABLES.map((t) => [t, []]));

const DataCtx = createContext<Ctx>(null as unknown as Ctx);
export const useData = () => useContext(DataCtx);

export function DataProvider({ children }: { children: ReactNode }) {
  const { session, setRoles } = useAuth();
  const [D, setD] = useState<Data>(EMPTY);
  const [days, setDays] = useState(3);
  const [loadedDays, setLoadedDays] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [challan, setChallan] = useState<Challan>({ last: null, prefix: null });
  const daysRef = useRef(days);
  daysRef.current = days;
  // Bumped by every local change, so a load that started before it does not put old rows back.
  const edits = useRef(0);

  const reload = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const asked = daysRef.current;
      const before = edits.current;
      const r = await api<{ tables: Data; me: { roles: string[] }; challan: Challan }>(`/sync/pull?days=${asked}`);
      // Something was saved while this was loading: these rows may be older than it, so load again.
      if (edits.current !== before) { setTimeout(() => reloadRef.current(), 0); return; }
      setD({ ...EMPTY, ...r.tables });
      setLoadedDays(asked);
      setRoles(r.me.roles);
      setChallan(r.challan);
      setLoadedAt(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    } finally {
      setLoading(false);
    }
  }, [session?.person.id, setRoles]);

  useEffect(() => {
    if (!session) return;
    reload();
    const t = setInterval(reload, 30_000); // keep the screens live
    return () => clearInterval(t);
  }, [session?.person.id, days, reload]);

  const patch = useCallback((table: string, change: (rows: Data[string]) => Data[string]) => {
    edits.current++;
    setD((d) => ({ ...d, [table]: change(d[table] ?? []) }));
  }, []);

  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  const needDays = useCallback((n: number) => setDays((d) => (n > d ? Math.min(400, n) : d)), []);
  const value = useMemo(() => ({ D, loading, error, loadedAt, challan, reload, needDays, loadedDays, patch }), [D, loading, error, loadedAt, challan, reload, needDays, loadedDays, patch]);
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}
