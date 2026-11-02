// What an operator records on a machine: the same entries the phone makes, with the same rules, for the laptop screens.
import { newId, push, type WriteOp } from "./api";
import type { Data } from "../shared/types";
import { fieldsFor } from "../shared/rules";
import { nowIso, shiftWindow, type Row } from "../shared/time";

/** Start a machine: the run, its helpers and the answers to the checks. A "No" blocks the start unless the operator runs anyway
 *  with a remark; then a job goes to maintenance and the run shows as on bypass. */
export async function startRun(D: Data, m: Row, me: string, answers: Record<string, boolean | null>, helpers: string[], runAnyway: boolean, remark: string) {
  const prestart = fieldsFor(D, m.stage, "prestart");
  if (!prestart.every((f) => answers[f.id] === true || answers[f.id] === false)) throw new Error("Answer every check before starting.");
  const failed = prestart.filter((f) => answers[f.id] === false);
  if (failed.length && !(runAnyway && remark.trim())) throw new Error('A "No" blocks the start. Tick Run anyway and write a remark to go on.');

  const runId = newId();
  const now = nowIso();
  const ops: WriteOp[] = [
    { table: "machine_run", data: { id: runId, machine_id: m.id, operator_id: me, started_at: now, stopped_at: null, stop_reason_id: null, notes: null, entered_by: me } },
    ...helpers.map((p) => ({ table: "run_helper", data: { run_id: runId, person_id: p } })),
    ...prestart.map((f) => ({ table: "prestart_answer", data: { run_id: runId, field_id: f.id, answer: answers[f.id] === true } })),
  ];
  if (failed.length) {
    const jobId = newId();
    ops.push(
      {
        table: "maintenance_job",
        data: {
          id: jobId, kind: "bypass", machine_id: m.id, problem: `Run anyway: ${failed.map((f) => f.label).join(", ")}`, note: remark.trim(),
          reported_by: me, reported_at: now, machine_stopped: false, downtime_id: null, fitter_id: null, started_at: null, fixed_at: null,
        },
      },
      { table: "run_bypass", data: { run_id: runId, remark: remark.trim(), job_id: jobId, by: me, at: now } },
    );
  }
  // Restarting ends any downtime that is still open (power cut, no raw material...).
  for (const d of D.downtime) if (d.machine_id === m.id && !d.ended_at) ops.push({ table: "downtime", data: { id: d.id, ended_at: now } });
  await push(ops);
}

/** Stop a machine with a reason. A breakdown or die change keeps the machine Down and opens a maintenance job. */
export async function stopRun(D: Data, m: Row, machineRun: Row, me: string, reasonId: string | null, note: string) {
  const reason = D.stop_reason.find((r) => r.id === reasonId);
  if (!reason) throw new Error("Choose why it is stopping.");
  const now = nowIso();
  const n = note.trim() || null;
  const ops: WriteOp[] = [{ table: "machine_run", data: { id: machineRun.id, stopped_at: now, stop_reason_id: reason.id, notes: n } }];
  const dtId = reason.machine_down ? newId() : null;
  if (dtId) ops.push({ table: "downtime", data: { id: dtId, machine_id: m.id, started_at: now, ended_at: null, stop_reason_id: reason.id, notes: n, job_id: null, entered_by: me } });
  if (reason.calls_maintenance) {
    const jobId = newId();
    ops.push({
      table: "maintenance_job",
      data: {
        id: jobId, kind: /die/i.test(String(reason.name)) ? "wear" : "breakdown", machine_id: m.id, problem: n ? `${reason.name}: ${n}` : String(reason.name),
        reported_by: me, reported_at: now, machine_stopped: !!reason.machine_down, downtime_id: dtId, fitter_id: null, started_at: null, fixed_at: null,
      },
    });
    if (dtId) ops.push({ table: "downtime", data: { id: dtId, job_id: jobId } });
  }
  await push(ops);
}

/** The hourly reading lines of a machine. On the briquette machine the 1-minute output weight is needed every hour,
 *  even if the log sheet lines are not set up. */
export function readingFields(D: Data, m: Row): Row[] {
  const base = fieldsFor(D, m.stage, "reading");
  return m.stage === "briquette" && !base.some((f) => f.field_key === "oneMin")
    ? [{ id: "_oneMin", field_key: "oneMin", label: "1-minute output weight", unit: "kg", required: true } as Row, ...base]
    : base;
}

function cleanValues(fields: Row[], vals: Record<string, string>) {
  for (const f of fields) {
    const v = (vals[f.field_key] ?? "").trim();
    if (f.required && !v) throw new Error(`Enter ${f.label}`);
    if (v && isNaN(Number(v))) throw new Error(`${f.label} must be a number`);
  }
  return Object.fromEntries(fields.filter((f) => (vals[f.field_key] ?? "").trim() !== "").map((f) => [f.field_key, Number(vals[f.field_key])]));
}

/** One hourly reading of a running machine. */
export async function addReading(D: Data, m: Row, runId: string, me: string, vals: Record<string, string>) {
  const clean = cleanValues(readingFields(D, m), vals);
  if (Object.keys(clean).length === 0) throw new Error("Fill in at least one reading.");
  await push([{ table: "log_reading", data: { id: newId(), machine_id: m.id, run_id: runId, at: nowIso(), vals: clean, one_min_kg: clean.oneMin ?? null, by: me } }]);
}

/** The greasing check, once a shift. */
export async function addGreasing(D: Data, m: Row, me: string, vals: Record<string, string>) {
  const w = shiftWindow(D.shift);
  if (!w) throw new Error("No shift is running.");
  const clean = cleanValues(fieldsFor(D, m.stage, "greasing"), vals);
  await push([{ table: "greasing_check", data: { id: newId(), machine_id: m.id, shift_start: w.start.toISOString(), vals: clean, by: me, at: nowIso() } }]);
}

/** Pellet bags counted into the store since the last count (or the start of the shift). */
export function pelletProduct(D: Data): Row | undefined {
  return D.material.find((x) => x.kind !== "Raw" && x.bag_kg != null);
}

export function lastBagCountTo(D: Data): string {
  const pellet = pelletProduct(D);
  const last = D.bag_count.filter((b) => b.product_id === pellet?.id).sort((a, b) => String(b.period_to).localeCompare(String(a.period_to)))[0];
  return last?.period_to ?? shiftWindow(D.shift)?.start.toISOString() ?? new Date(Date.now() - 6 * 3_600_000).toISOString();
}

export async function addBags(D: Data, me: string, bagsText: string, kgText: string) {
  const pellet = pelletProduct(D);
  if (!pellet) throw new Error("No pellet product is set up.");
  const n = Number(bagsText);
  if (!bagsText.trim() || !Number.isInteger(n) || n <= 0) throw new Error("Enter the number of bags");
  const k = Number(kgText);
  if (!(k > 0)) throw new Error("Enter kg per bag");
  const now = nowIso();
  await push([{ table: "bag_count", data: { id: newId(), product_id: pellet.id, period_from: lastBagCountTo(D), period_to: now, bags: n, kg_per_bag: k, entered_by: me, entered_at: now } }]);
}

/** The operator at the chipper, wet hammer mill or dryer marks when he starts and empties a yard. */
export const yardStart = (batchId: string, me: string) => push([{ table: "yard_batch", data: { id: batchId, started_at: nowIso(), started_by: me } }]);
export const yardEmpty = (batchId: string, me: string) => push([{ table: "yard_batch", data: { id: batchId, finished_at: nowIso(), finished_by: me } }]);

/** Report a problem: goes straight to the fitters. */
export async function reportProblem(me: string, machineId: string | null, preset: string | null, note: string, stopped: boolean) {
  if (!machineId) throw new Error("Choose the machine");
  if (!preset) throw new Error("Choose what is wrong");
  await push([{
    table: "maintenance_job",
    data: {
      id: newId(), kind: "problem", machine_id: machineId, problem: preset, note: note.trim() || null, reported_by: me, reported_at: nowIso(),
      machine_stopped: stopped, downtime_id: null, fitter_id: null, started_at: null, fixed_at: null,
    },
  }]);
}