import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useData } from "../lib/data";
import { useAuth } from "../lib/auth";
import { api, push } from "../lib/api";
import { cls } from "../lib/util";
import { Button, Card, ErrorText, Field, Modal, PageHeader, useRun } from "../components/ui";
import { personName } from "../shared/rules";
import { addDays, dayKey, dayKeyStart, fmtDayKey, fmtTime, nowIso } from "../shared/time";
import { fmtDay, useDateMode } from "../lib/nepali";

type Ping = { id: string; person_id: string; at: string; action: string; lat: number | null; lng: number | null; accuracy_m: number | null; note: string | null };
type Factory = { lat: number; lng: number; radius_m: number };

const FACTORY_KEY = "factory_location";

/** Distance between two points on the earth, in metres. */
function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmtDist = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

/** Where phones were when people signed in or made an entry. The Owner only. */
export default function Locations() {
  const { D } = useData();
  const [mode] = useDateMode();
  const today = dayKey();
  const [day, setDay] = useState(today);
  const [who, setWho] = useState("");
  const [awayOnly, setAwayOnly] = useState(false);
  const [pings, setPings] = useState<Ping[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setOpen, setSetOpen] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);

  const factory = useMemo<Factory | null>(() => {
    const v = D.setting?.find((s) => s.key === FACTORY_KEY)?.value;
    return v && typeof v.lat === "number" && typeof v.lng === "number" ? (v as Factory) : null;
  }, [D.setting]);

  const load = useCallback(async () => {
    const from = dayKeyStart(day);
    const to = new Date(from.getTime() + 86_400_000);
    try {
      const r = await api<{ pings: Ping[] }>(`/admin/locations?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`);
      setPings(r.pings);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    }
  }, [day]);
  useEffect(() => { setPings(null); load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);

  const rows = useMemo(
    () =>
      (pings ?? []).map((p) => {
        const has = p.lat != null && p.lng != null;
        const dist = has && factory ? metres(factory, { lat: p.lat!, lng: p.lng! }) : null;
        // Away only when the reading, even allowing for its accuracy, is outside the factory circle.
        const away = dist != null && factory ? dist - Math.min(p.accuracy_m ?? 0, 500) > factory.radius_m : false;
        return { ...p, has, dist, away, name: personName(D, p.person_id) };
      }),
    [pings, factory, D],
  );
  const people = useMemo(() => [...new Map(rows.map((r) => [r.person_id, r.name])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows]);
  const shown = rows.filter((r) => (!who || r.person_id === who) && (!awayOnly || r.away));
  const awayCount = rows.filter((r) => r.away).length;
  const noFix = rows.filter((r) => !r.has).length;

  return (
    <div className="space-y-4">
      <PageHeader title="Locations" sub="Where phones were when people signed in or made an entry. Only the Owner sees this.">
        <Button kind="ghost" onClick={() => setSetOpen(true)}>{factory ? "Factory location" : "Set factory location"}</Button>
      </PageHeader>

      {!factory ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Set the factory location so the page can flag entries made away from the factory.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-1 py-0.5">
          <button aria-label="Previous day" className="grid h-9 w-9 place-items-center rounded-full text-xl text-brand-700 hover:bg-slate-100" onClick={() => setDay(addDays(day, -1))}>‹</button>
          <span className="min-w-40 text-center text-sm font-semibold text-slate-900">{fmtDay(day, mode)}{day === today ? " · Today" : ""}</span>
          <button aria-label="Next day" disabled={day >= today} className="grid h-9 w-9 place-items-center rounded-full text-xl text-brand-700 hover:bg-slate-100 disabled:opacity-30" onClick={() => setDay(addDays(day, 1))}>›</button>
        </div>
        <input type="date" aria-label="Day" value={day} max={today} onChange={(e) => e.target.value && e.target.value <= today && setDay(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
        <select aria-label="Person" value={who} onChange={(e) => setWho(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
          <option value="">Everyone ({people.length})</option>
          {people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <input type="checkbox" checked={awayOnly} onChange={(e) => setAwayOnly(e.target.checked)} disabled={!factory} />
          Away from the factory only
        </label>
        <span className="ml-auto text-xs text-slate-500">
          {pings ? `${rows.length} entries · ${awayCount} away · ${noFix} without location` : "Loading..."}
        </span>
      </div>
      <ErrorText text={error} />

      <MapView rows={shown} factory={factory} focus={focus} />

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Time</th>
              <th className="px-3 py-3">Person</th>
              <th className="px-3 py-3">Doing</th>
              <th className="px-3 py-3">Where</th>
              <th className="px-3 py-3">Accuracy</th>
              <th className="px-3 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((r) => (
              <tr key={r.id} className={cls(r.away && "bg-red-50/60", focus === r.id && "outline outline-2 outline-brand-700/40")}>
                <td className="px-4 py-2.5 tabular-nums">{fmtTime(r.at)}</td>
                <td className="px-3 py-2.5 font-semibold text-slate-900">{r.name}</td>
                <td className="px-3 py-2.5 text-slate-600">{r.action}</td>
                <td className="px-3 py-2.5">
                  {!r.has ? (
                    <span className="text-slate-500">{r.note ?? "No location"}</span>
                  ) : r.dist == null ? (
                    <span className="text-slate-600">{r.lat!.toFixed(5)}, {r.lng!.toFixed(5)}</span>
                  ) : r.away ? (
                    <span className="font-semibold text-red-700">Away · {fmtDist(r.dist)} from the factory</span>
                  ) : (
                    <span className="font-semibold text-emerald-700">At the factory</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-slate-500">{r.accuracy_m != null ? `± ${fmtDist(r.accuracy_m)}` : ""}</td>
                <td className="px-3 py-2.5 text-right">
                  {r.has ? (
                    <span className="flex justify-end gap-3 text-xs font-semibold">
                      <button onClick={() => setFocus(r.id)} className="text-brand-700 hover:underline">Show on map</button>
                      <a href={`https://www.google.com/maps?q=${r.lat},${r.lng}`} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">Google Maps ↗</a>
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {pings && shown.length === 0 ? <p className="p-6 text-center text-sm text-slate-500">Nothing recorded{who || awayOnly ? " for this filter" : ` on ${fmtDayKey(day)}`}.</p> : null}
      </div>
      <p className="text-xs text-slate-500">
        A phone notes its location only when someone signs in or makes an entry, never in the background. Readings indoors can be off by 20 to 50 metres;
        an entry counts as away only when it is outside the factory circle even allowing for that.
      </p>

      {setOpen ? <FactoryModal current={factory} recent={rows.filter((r) => r.has)} onClose={() => setSetOpen(false)} /> : null}
    </div>
  );
}

type Shown = Ping & { has: boolean; dist: number | null; away: boolean; name: string };

/** OpenStreetMap with a dot per entry (green at the factory, red away) and the factory circle. */
function MapView({ rows, factory, focus }: { rows: Shown[]; factory: Factory | null; focus: string | null }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const dots = useRef(new Map<string, L.CircleMarker>());

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { scrollWheelZoom: false }).setView(factory ? [factory.lat, factory.lng] : [27.7, 85.32], factory ? 15 : 7);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    dots.current.clear();
    const pts: L.LatLngExpression[] = [];
    if (factory) {
      L.circle([factory.lat, factory.lng], { radius: factory.radius_m, color: "#744820", weight: 2, fillOpacity: 0.08 }).bindTooltip("Factory").addTo(g);
      pts.push([factory.lat, factory.lng]);
    }
    for (const r of rows) {
      if (!r.has) continue;
      const color = !factory ? "#1c4f9c" : r.away ? "#c0392b" : "#2e7d32";
      const dot = L.circleMarker([r.lat!, r.lng!], { radius: 7, color: "#fff", weight: 2, fillColor: color, fillOpacity: 0.95 })
        .bindPopup(`<b>${escapeHtml(r.name)}</b><br>${escapeHtml(r.action)}<br>${fmtTime(r.at)}${r.accuracy_m != null ? ` · ± ${fmtDist(r.accuracy_m)}` : ""}`)
        .addTo(g);
      dots.current.set(r.id, dot);
      pts.push([r.lat!, r.lng!]);
    }
    if (pts.length > 1) m.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 17 });
    else if (pts.length === 1) m.setView(pts[0], 16);
  }, [rows, factory]);

  useEffect(() => {
    const dot = focus ? dots.current.get(focus) : null;
    if (dot && map.current) { map.current.setView(dot.getLatLng(), 17); dot.openPopup(); el.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }
  }, [focus]);

  return <div ref={el} className="isolate z-0 h-[26rem] w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-100" />;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The Owner sets where the factory is and how far around it still counts as at the factory. */
function FactoryModal({ current, recent, onClose }: { current: Factory | null; recent: Shown[]; onClose: () => void }) {
  const { patch } = useData();
  const { session } = useAuth();
  const { busy, error, setError, run } = useRun();
  const [spot, setSpot] = useState(current ? `${current.lat}, ${current.lng}` : "");
  const [radius, setRadius] = useState(String(current?.radius_m ?? 300));
  const here = recent.find((r) => r.action === "Sign in" && (r.accuracy_m ?? 999) <= 100);

  const save = async () => {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(spot);
    const rad = Number(radius);
    if (!m) return setError("Enter the location as latitude, longitude, for example 27.71234, 85.31234 (copy it from Google Maps).");
    if (!Number.isInteger(rad) || rad < 50 || rad > 20000) return setError("The distance must be a whole number from 50 to 20000 metres.");
    const value = { lat: Number(m[1]), lng: Number(m[2]), radius_m: rad };
    const row = { key: FACTORY_KEY, value, changed_by: session!.person.id, changed_at: nowIso() };
    const ok = await run(async () => {
      await push([{ table: "setting", data: row }], true);
      patch("setting", (rows) => [...rows.filter((r) => r.key !== FACTORY_KEY), row]);
    });
    if (ok) onClose();
  };

  return (
    <Modal title="Factory location" onClose={onClose}>
      <p className="mb-3 text-sm text-slate-600">
        In Google Maps, right-click the middle of the factory and click the numbers at the top to copy them. Paste them here.
      </p>
      <Field label="Latitude, longitude" value={spot} onChange={setSpot} placeholder="27.71234, 85.31234" />
      {here ? (
        <button onClick={() => setSpot(`${here.lat!.toFixed(6)}, ${here.lng!.toFixed(6)}`)} className="mt-1 text-xs font-semibold text-brand-700 hover:underline">
          Use where {here.name} signed in at {fmtTime(here.at)}
        </button>
      ) : null}
      <div className="mt-3">
        <Field label="Counts as at the factory within (metres)" value={radius} onChange={setRadius} placeholder="300" />
      </div>
      <div className="mt-3"><ErrorText text={error} /></div>
      <div className="mt-4 flex justify-end gap-2">
        <Button kind="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={save}>Save</Button>
      </div>
    </Modal>
  );
}
