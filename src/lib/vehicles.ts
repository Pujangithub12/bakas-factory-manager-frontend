// Vehicle work and diesel: the same entries the driver makes on the phone, with the same rules, for the laptop screens.
import { newId, push } from "./api";
import type { Data } from "../shared/types";
import { nowIso, type Row } from "../shared/time";

const HOUR = 3_600_000;

export const PURPOSES = ["Feeding the chippers", "Moving raw material", "Loading a sales truck", "Other"];

const ms = (v: unknown) => new Date(String(v)).getTime();

/** "12,5" or "12.5" as a number, or null when it is not one. */
export const parseNum = (v: string) => {
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

export const openSession = (D: Data, vehicleId: string): Row | undefined => D.vehicle_session.find((x) => x.vehicle_id === vehicleId && !x.stopped_at);

/** The last hour meter reading of a vehicle: from its work sessions or its diesel fills, whichever is newest. */
export function lastMeter(D: Data, vehicleId: string): number | null {
  let best: { at: number; v: number } | null = null;
  for (const x of D.vehicle_session) {
    if (x.vehicle_id !== vehicleId) continue;
    const raw = x.meter_end ?? x.meter_start;
    const v = raw == null ? NaN : Number(raw);
    const at = ms(x.stopped_at ?? x.started_at);
    if (!Number.isNaN(v) && (!best || at > best.at)) best = { at, v };
  }
  for (const f of D.diesel_fill) {
    if (f.vehicle_id !== vehicleId || f.meter == null) continue;
    const at = ms(f.at);
    if (!best || at > best.at) best = { at, v: Number(f.meter) };
  }
  return best ? best.v : null;
}

export type VehStats = { hrs: number; lit: number; used: number; dm: number; lph: number | null; n: number; last: Row | null };

/** Hours worked, diesel and litres per hour for one vehicle between two times. Litres per hour = diesel put in after the
 *  first fill, divided by the hour meter between the first and the last fill. */
export function vehStats(D: Data, vehicleId: string, from: number, to: number): VehStats {
  const sessions = D.vehicle_session.filter((x) => x.vehicle_id === vehicleId && ms(x.started_at) >= from && ms(x.started_at) < to);
  const hrs = sessions.filter((x) => x.meter_end != null).reduce((n, x) => n + (Number(x.meter_end) - Number(x.meter_start)), 0);
  const fills = D.diesel_fill.filter((f) => f.vehicle_id === vehicleId && ms(f.at) >= from && ms(f.at) < to).sort((a, b) => ms(a.at) - ms(b.at));
  const lit = fills.reduce((n, f) => n + Number(f.litres), 0);
  let used = 0;
  let dm = 0;
  if (fills.length >= 2) {
    used = fills.slice(1).reduce((n, f) => n + Number(f.litres), 0);
    dm = Number(fills[fills.length - 1].meter) - Number(fills[0].meter);
  }
  return { hrs, lit, used, dm, lph: dm > 0 ? used / dm : null, n: sessions.length, last: fills[fills.length - 1] ?? null };
}

export async function startWork(D: Data, vehicleId: string, me: string, meterText: string, job: string) {
  const m = parseNum(meterText);
  if (m == null) throw new Error("Enter the hour meter reading.");
  const last = lastMeter(D, vehicleId);
  if (last != null && m < last) throw new Error(`The meter cannot be below the last reading (${last.toFixed(1)}).`);
  if (openSession(D, vehicleId)) throw new Error("This vehicle is already working.");
  await push([{ table: "vehicle_session", data: { id: newId(), vehicle_id: vehicleId, driver_id: me, started_at: nowIso(), stopped_at: null, meter_start: m, meter_end: null, job: job || "Other" } }]);
}

export async function stopWork(session: Row, meterText: string) {
  const m = parseNum(meterText);
  if (m == null) throw new Error("Enter the hour meter reading.");
  const start = Number(session.meter_start);
  if (m < start) throw new Error(`The meter cannot be below the start reading (${start.toFixed(1)}).`);
  const since = Date.now() - ms(session.started_at);
  if (m - start > since / HOUR + 0.5) throw new Error(`That is ${(m - start).toFixed(1)} hours on the meter, but work started only ${(since / HOUR).toFixed(1)} hours ago. Check the reading.`);
  await push([{ table: "vehicle_session", data: { id: session.id, stopped_at: nowIso(), meter_end: m } }]);
}

export async function addDiesel(D: Data, vehicleId: string, me: string, litresText: string, meterText: string) {
  const l = parseNum(litresText);
  const m = parseNum(meterText);
  if (l == null || l <= 0 || l > 500) throw new Error("Enter the litres filled (1 to 500).");
  if (m == null) throw new Error("Enter the hour meter reading.");
  const last = lastMeter(D, vehicleId);
  if (last != null && m < last) throw new Error(`The meter cannot be below the last reading (${last.toFixed(1)}).`);
  await push([{ table: "diesel_fill", data: { id: newId(), vehicle_id: vehicleId, at: nowIso(), litres: Math.round(l), meter: m, by: me } }]);
}