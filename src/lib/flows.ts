// The same entries the phone makes, with the same rules, for the laptop screens.
import { newId, push } from "./api";
import type { Data } from "../shared/types";
import { fillingBatch, batchTickets, busyPeople, machineOf, num, onSiteMap } from "../shared/rules";
import { nowIso, shiftForArrival, type Row } from "../shared/time";

export async function checkIn(D: Data, personIds: string[], me: string) {
  const w = shiftForArrival(D.shift);
  if (!w) throw new Error("No shifts are set up yet.");
  const site = onSiteMap(D);
  const ops = personIds.filter((id) => !site.has(id)).map((id) => ({
    table: "attendance",
    data: { id: newId(), person_id: id, shift_id: w.shift.id, shift_start: w.start.toISOString(), gate_in: nowIso(), gate_out: null, gate_by: me, on_duty_at: null, on_duty_by: null },
  }));
  if (ops.length) await push(ops);
}

export async function checkOut(D: Data, personIds: string[]) {
  const site = onSiteMap(D);
  const busy = busyPeople(D);
  const blocked: string[] = [];
  const ops = [];
  for (const id of personIds) {
    const a = site.get(id);
    if (!a) continue;
    const r = busy.get(id);
    if (r) { blocked.push(`${D.person.find((p) => p.id === id)?.full_name} (${machineOf(D, r.machine_id)?.tag})`); continue; }
    ops.push({ table: "attendance", data: { id: a.id, gate_out: nowIso() } });
  }
  if (ops.length) await push(ops);
  if (blocked.length) throw new Error(`${blocked.join(", ")} cannot be checked out until the run is stopped.`);
}

export async function registerPerson(D: Data, me: string, mgmt: boolean, f: { name: string; mobile: string; address: string; idNo: string; role: string }) {
  const name = f.name.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Enter the name");
  if (!/^\d{10}$/.test(f.mobile)) throw new Error("Mobile must be 10 digits");
  if (!f.address.trim()) throw new Error("Enter the address");
  if (!f.role) throw new Error("Choose what the person works as");
  if (D.person.some((p) => p.full_name.trim().toLowerCase() === name.toLowerCase())) throw new Error("A person with this name is already registered.");
  if (D.person.some((p) => p.mobile === f.mobile)) throw new Error("This mobile number is already registered.");
  const w = shiftForArrival(D.shift);
  if (!w) throw new Error("No shifts are set up yet.");
  const id = newId();
  const now = nowIso();
  await push([
    { table: "person", data: { id, full_name: name, mobile: f.mobile, address: f.address.trim(), id_no: f.idNo.trim() || null, active: true, checked: mgmt, registered_by: me, registered_at: now, checked_by: mgmt ? me : null, checked_at: mgmt ? now : null } },
    { table: "person_role", data: { person_id: id, role: f.role, is_main: true } },
    { table: "attendance", data: { id: newId(), person_id: id, shift_id: w.shift.id, shift_start: w.start.toISOString(), gate_in: now, gate_out: null, gate_by: me, on_duty_at: null, on_duty_by: null } },
  ]);
}

export const confirmWorker = (personId: string, me: string) => push([{ table: "person", data: { id: personId, checked: true, checked_by: me, checked_at: nowIso() } }]);
export const markOnDuty = (attId: string, me: string) => push([{ table: "attendance", data: { id: attId, on_duty_at: nowIso(), on_duty_by: me } }]);

export const setInCharge = (shiftStartIso: string, shiftId: string, personId: string, me: string) =>
  push([{ table: "shift_in_charge", data: { shift_start: shiftStartIso, shift_id: shiftId, person_id: personId, set_by: me, set_at: nowIso() } }]);

export const toggleOperatorMachine = (personId: string, machineId: string, on: boolean) =>
  push([{ table: "operator_machine", op: on ? "upsert" : "delete", data: { person_id: personId, machine_id: machineId } }]);

type Truck = { wbsn: string; vehicleNo: string; vehicleType: string; driver: string; contact: string; materialId: string; first: string; remarks: string };

function ticketBase(D: Data, t: Truck, me: string) {
  const wbsn = Number(t.wbsn);
  if (!Number.isInteger(wbsn) || wbsn <= 0) throw new Error("Weighbridge serial must be a whole number");
  if (D.weigh_ticket.some((x) => num(x.wbsn) === wbsn)) throw new Error(`Serial ${wbsn} is already entered.`);
  if (!t.vehicleNo.trim()) throw new Error("Enter the vehicle number");
  if (!t.materialId) throw new Error("Choose the material");
  const first = Number(t.first);
  if (!Number.isInteger(first) || first <= 0) throw new Error("Enter the first weight as whole kg");
  return {
    id: newId(), wbsn, vehicle_type: t.vehicleType || null, vehicle_no: t.vehicleNo.trim(), driver_name: t.driver.trim() || null, driver_contact: t.contact.trim() || null,
    material_id: t.materialId, first_kg: first, first_at: nowIso(), second_kg: null, second_at: null, remarks: t.remarks.trim() || null, entered_by: me, out_by: null,
    moisture_1: null, moisture_2: null, moisture_3: null, batch_id: null, challan_no: null, po_no: null, vcts_no: null, supplier_id: null, buyer_id: null,
  };
}

export async function truckIn(D: Data, me: string, t: Truck & { supplierId: string; yardId: string; moisture: [string, string, string] }) {
  const base = ticketBase(D, t, me);
  if (!t.supplierId) throw new Error("Choose the supplier");
  const moist = t.moisture.map((v) => (v.trim() === "" ? NaN : Number(v)));
  if (moist.some((v) => isNaN(v) || v < 0 || v > 99)) throw new Error("Enter all three moisture readings (0 to 99)");
  if (!t.yardId) throw new Error("Choose the yard to unload at");
  const yard = D.yard.find((y) => y.id === t.yardId)!;
  const now = nowIso();
  const ops: { table: string; data: Row }[] = [];
  let batch = fillingBatch(D, t.yardId);
  if (!batch) {
    const seq = Math.max(0, ...D.yard_batch.filter((b) => b.yard_id === t.yardId).map((b) => num(b.seq))) + 1;
    batch = { id: newId(), yard_id: t.yardId, seq, opened_at: now, closed_at: null, started_at: null, finished_at: null, started_by: null, finished_by: null };
    ops.push({ table: "yard_batch", data: batch });
  }
  ops.push({ table: "weigh_ticket", data: { ...base, direction: "in", supplier_id: t.supplierId, moisture_1: moist[0], moisture_2: moist[1], moisture_3: moist[2], batch_id: batch.id } });
  const trucks = batchTickets(D, batch.id).length + 1;
  const full = !!yard.holds_trucks && trucks >= num(yard.holds_trucks);
  if (full) ops.push({ table: "yard_batch", data: { id: batch.id, closed_at: now } });
  await push(ops);
  return full ? `${yard.name} reached its limit of ${yard.holds_trucks} trucks and is closed for filling.` : null;
}

export async function truckOut(D: Data, me: string, t: Truck & { buyerId: string; challan: string; po: string }) {
  const base = ticketBase(D, t, me);
  if (!t.buyerId) throw new Error("Choose the buyer");
  const challan = t.challan.trim();
  if (!challan) throw new Error("Enter the challan no. from the challan book");
  if (D.weigh_ticket.some((x) => x.challan_no === challan)) throw new Error(`Challan ${challan} is already used.`);
  await push([{ table: "weigh_ticket", data: { ...base, direction: "out", buyer_id: t.buyerId, challan_no: challan, po_no: t.po.trim() || null } }]);
}

export async function weighOut(ticket: Row, secondKg: string, me: string) {
  const w = Number(secondKg);
  if (!Number.isInteger(w) || w <= 0) throw new Error("Enter the second weight as whole kg");
  const isIn = ticket.direction === "in";
  const net = isIn ? num(ticket.first_kg) - w : w - num(ticket.first_kg);
  if (net <= 0) throw new Error(isIn ? "The empty truck must weigh less than the loaded truck." : "The loaded truck must weigh more than the empty truck.");
  await push([{ table: "weigh_ticket", data: { id: ticket.id, second_kg: w, second_at: nowIso(), out_by: me } }]);
  return net;
}

export const stopFilling = (batchId: string) => push([{ table: "yard_batch", data: { id: batchId, closed_at: nowIso() } }]);

export const takeJob = (jobId: string, me: string) => push([{ table: "maintenance_job", data: { id: jobId, fitter_id: me, started_at: nowIso() } }]);

export async function fixJob(D: Data, job: Row, work: string, parts: string) {
  if (!work.trim()) throw new Error("Write the work done");
  const now = nowIso();
  const ops: { table: string; data: Row }[] = [{ table: "maintenance_job", data: { id: job.id, fixed_at: now, work_done: work.trim(), parts_used: parts.trim() || null } }];
  const dt = job.downtime_id ? D.downtime.find((d) => d.id === job.downtime_id) : null;
  if (dt && !dt.ended_at) ops.push({ table: "downtime", data: { id: dt.id, ended_at: now } });
  await push(ops);
}
