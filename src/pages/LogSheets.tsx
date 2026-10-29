import { useEffect, useMemo, useState } from "react";
import { useData } from "../lib/data";
import { useAuth } from "../lib/auth";
import { push } from "../lib/api";
import { Badge, Button, Card, ErrorText, Field, Modal, PageHeader, Select, Table, Td, useRun } from "../components/ui";
import { DAY, dayLabel, dayStartOf, hoursFmt, kgFmt } from "../lib/util";
import { batchCode, batchMaterial, batchTickets, briquetteKg, fieldsFor, num, pelletKg, personName, sumNet } from "../shared/rules";
import { fmtDateTime, fmtTime, HOUR, MIN, type Row } from "../shared/time";

const todMinutes = (v: string) => { const d = new Date(v); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

export default function LogSheets() {
  const { D, reload, needDays } = useData();
  const { session } = useAuth();
  const canEdit = session!.roles.some((r) => r === "Owner" || r === "Manager");
  const [machineId, setMachineId] = useState("");
  const [day, setDay] = useState(dayLabel(new Date()));
  const [shiftId, setShiftId] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);

  const machines = useMemo(() => [...D.machine].sort((a, b) => a.tag.localeCompare(b.tag)), [D.machine]);
  const shifts = useMemo(() => [...D.shift].sort((a, b) => todMinutes(a.starts) - todMinutes(b.starts)), [D.shift]);
  useEffect(() => { if (!machineId && machines[0]) setMachineId(machines[0].id); }, [machines, machineId]);
  useEffect(() => { if (!shiftId && shifts[0]) setShiftId(shifts[0].id); }, [shifts, shiftId]);
  useEffect(() => needDays(Math.ceil((Date.now() - dayStartOf(day).getTime()) / DAY) + 2), [day, needDays]);

  const m = machines.find((x) => x.id === machineId);
  const shift = shifts.find((x) => x.id === shiftId);

  const sheet = useMemo(() => {
    if (!m || !shift) return null;
    const s = todMinutes(shift.starts);
    const e = todMinutes(shift.ends);
    const mid = dayStartOf(day).getTime() - 6 * HOUR; // midnight Nepal time of that date
    const start = mid + s * MIN + (s < 360 ? DAY : 0);
    const end = start + (e <= s ? e + 1440 - s : e - s) * MIN;
    const now = Date.now();

    const runs = D.machine_run.filter((r) => r.machine_id === m.id && overlap(new Date(r.started_at).getTime(), r.stopped_at ? new Date(r.stopped_at).getTime() : now, start, end) > 0)
      .sort((a, b) => a.started_at.localeCompare(b.started_at));
    const runMs = runs.reduce((n, r) => n + overlap(new Date(r.started_at).getTime(), r.stopped_at ? new Date(r.stopped_at).getTime() : now, start, end), 0);
    const downs = D.downtime.filter((d) => d.machine_id === m.id && overlap(new Date(d.started_at).getTime(), d.ended_at ? new Date(d.ended_at).getTime() : now, start, end) > 0);
    const downMs = downs.reduce((n, d) => n + overlap(new Date(d.started_at).getTime(), d.ended_at ? new Date(d.ended_at).getTime() : now, start, end), 0);
    const inCharge = D.shift_in_charge.find((x) => new Date(x.shift_start).getTime() === start);
    const readings = D.log_reading.filter((r) => r.machine_id === m.id && new Date(r.at).getTime() >= start && new Date(r.at).getTime() < end).sort((a, b) => a.at.localeCompare(b.at));
    const grease = D.greasing_check.filter((g) => g.machine_id === m.id && new Date(g.at).getTime() >= start && new Date(g.at).getTime() < end);
    const batches = D.yard_batch.filter((b) => b.started_at && overlap(new Date(b.started_at).getTime(), b.finished_at ? new Date(b.finished_at).getTime() : now, start, end) > 0);
    const production = m.stage === "pellet" ? { label: "Pellets", kg: pelletKg(D, new Date(start), new Date(end)) }
      : m.stage === "briquette" ? { label: "Briquettes", kg: briquetteKg(D, new Date(start), new Date(end), m.id) } : null;
    return { start, end, runs, runMs, downs, downMs, inCharge, readings, grease, batches, production };
  }, [D, m, shift, day]);

  const fields = m ? fieldsFor(D, m.stage, "reading") : [];
  const hasOneMinField = fields.some((f) => f.field_key === "oneMin");
  const prestart = m ? fieldsFor(D, m.stage, "prestart") : [];
  const greasingFields = m ? fieldsFor(D, m.stage, "greasing") : [];

  return (
    <div>
      <PageHeader title="Log sheets" sub="The paper log sheet, rebuilt per machine and shift. Header and totals fill themselves.">
        <Select value={machineId} onChange={setMachineId} placeholder="Machine" options={machines.map((x) => ({ value: x.id, label: `${x.tag} ${x.name}` }))} />
        <Field label="" type="date" value={day} onChange={setDay} />
        <Select value={shiftId} onChange={setShiftId} placeholder="Shift" options={shifts.map((x) => ({ value: x.id, label: `${x.name} ${hm(todMinutes(x.starts))}-${hm(todMinutes(x.ends))}` }))} />
        <span className="no-print"><Button kind="ghost" onClick={() => window.print()}>Print</Button></span>
      </PageHeader>

      {!m || !shift || !sheet ? <p className="text-slate-500">Choose a machine and a shift.</p> : (
        <div className="space-y-4">
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">{m.tag} · {m.name}</h2>
              <span className="text-sm text-slate-500">Production day {day} · {shift.name} shift</span>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
              <Item k="Shift in charge" v={sheet.inCharge ? personName(D, sheet.inCharge.person_id) : "Not set"} />
              <Item k="Operator" v={[...new Set(sheet.runs.map((r) => personName(D, r.operator_id)))].join(", ") || "-"} />
              <Item k="Started" v={sheet.runs[0] ? fmtTime(new Date(Math.max(new Date(sheet.runs[0].started_at).getTime(), sheet.start)).toISOString()) : "-"} />
              <Item k="Ended" v={sheet.runs.length ? (sheet.runs[sheet.runs.length - 1].stopped_at ? fmtTime(sheet.runs[sheet.runs.length - 1].stopped_at) : "Still running") : "-"} />
              <Item k="Run hours" v={hoursFmt(sheet.runMs)} />
              <Item k="Breakdown time" v={sheet.downs.length ? `${hoursFmt(sheet.downMs)} (${sheet.downs.length})` : "None"} />
              <Item k={sheet.production?.label ?? "Production"} v={sheet.production ? `${kgFmt(Math.round(sheet.production.kg))} kg` : "-"} />
              <Item
                k="In-feed raw material"
                v={sheet.batches.length ? sheet.batches.map((b) => `${batchCode(D, b)} ${batchMaterial(D, b)?.name ?? ""} (${kgFmt(sumNet(batchTickets(D, b.id)))} kg)`).join("; ") : "-"}
              />
            </dl>
            {sheet.downs.length ? (
              <p className="mt-3 text-sm text-red-700">
                Breakdowns: {sheet.downs.map((d) => `${D.stop_reason.find((s) => s.id === d.stop_reason_id)?.name ?? "Down"} ${fmtTime(d.started_at)}-${d.ended_at ? fmtTime(d.ended_at) : "now"}`).join("; ")}
              </p>
            ) : null}
          </Card>

          <h3 className="font-semibold">Hourly readings</h3>
          {fields.length === 0 && m.stage !== "briquette" ? <p className="text-sm text-slate-500">No log sheet lines are set up for this machine. Add them under Setup lists.</p> : (
            <Table head={["Time", ...(m.stage === "briquette" && !hasOneMinField ? ["1-min kg"] : []), ...fields.map((f) => `${f.label}${f.unit ? ` (${f.unit})` : ""}`), "By", ""]} empty="No readings in this shift.">
              {sheet.readings.map((r) => (
                <tr key={r.id}>
                  <Td className="font-semibold">{fmtTime(r.at)}</Td>
                  {m.stage === "briquette" && !hasOneMinField ? <Td>{r.one_min_kg ?? "-"}</Td> : null}
                  {fields.map((f) => <Td key={f.id}>{r.vals?.[f.field_key] ?? "-"}</Td>)}
                  <Td>{personName(D, r.by)}</Td>
                  <Td className="no-print">{canEdit ? <Button small kind="ghost" onClick={() => setEditing(r)}>Correct</Button> : null}</Td>
                </tr>
              ))}
            </Table>
          )}

          {prestart.length ? (
            <>
              <h3 className="font-semibold">Checks at start</h3>
              <Table head={["Started", "Operator", ...prestart.map((f) => f.label), "Bypass"]} empty="No starts in this shift.">
                {sheet.runs.map((r) => {
                  const bypass = D.run_bypass.find((b) => b.run_id === r.id);
                  return (
                    <tr key={r.id}>
                      <Td>{fmtDateTime(r.started_at)}</Td><Td>{personName(D, r.operator_id)}</Td>
                      {prestart.map((f) => { const a = D.prestart_answer.find((x) => x.run_id === r.id && x.field_id === f.id); return <Td key={f.id}>{a ? <Badge tone={a.answer ? "good" : "bad"}>{a.answer ? "Yes" : "No"}</Badge> : "-"}</Td>; })}
                      <Td>{bypass ? <span className="text-red-700">{bypass.remark}</span> : "-"}</Td>
                    </tr>
                  );
                })}
              </Table>
            </>
          ) : null}

          {greasingFields.length ? (
            <>
              <h3 className="font-semibold">Greasing</h3>
              <Table head={["Time", ...greasingFields.map((f) => `${f.label}${f.unit ? ` (${f.unit})` : ""}`), "By"]} empty="No greasing this shift.">
                {sheet.grease.map((g) => <tr key={g.id}><Td>{fmtTime(g.at)}</Td>{greasingFields.map((f) => <Td key={f.id}>{g.vals?.[f.field_key] ?? "-"}</Td>)}<Td>{personName(D, g.by)}</Td></tr>)}
              </Table>
            </>
          ) : null}
        </div>
      )}

      {editing && m ? <ReadingEditor reading={editing} fields={fields} showOneMin={m.stage === "briquette"} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); }} /> : null}
    </div>
  );
}

const Item = ({ k, v }: { k: string; v: string }) => (
  <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{k}</dt><dd className="font-medium">{v}</dd></div>
);

function ReadingEditor({ reading, fields, showOneMin, onClose, onSaved }: { reading: Row; fields: Row[]; showOneMin: boolean; onClose: () => void; onSaved: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>(Object.fromEntries(fields.map((f) => [f.field_key, String(reading.vals?.[f.field_key] ?? "")])));
  const [oneMin, setOneMin] = useState(reading.one_min_kg != null ? String(num(reading.one_min_kg)) : "");
  const { D } = useData();
  const { busy, error, run } = useRun(onSaved);

  const save = () =>
    run(async () => {
      const clean: Record<string, number> = {};
      for (const f of fields) {
        const v = vals[f.field_key].trim();
        if (v === "") { if (f.required) throw new Error(`${f.label} is required`); continue; }
        if (isNaN(Number(v))) throw new Error(`${f.label} must be a number`);
        clean[f.field_key] = Number(v);
      }
      const one = oneMin.trim() === "" ? null : Number(oneMin);
      if (one != null && isNaN(one)) throw new Error("1-minute weight must be a number");
      if (showOneMin && one == null) throw new Error("The briquette 1-minute weight is required");
      await push([{ table: "log_reading", data: { id: reading.id, vals: { ...(reading.vals ?? {}), ...clean }, one_min_kg: one ?? clean.oneMin ?? null } }], true);
    });

  return (
    <Modal title={`Correct the ${fmtTime(reading.at)} reading`} onClose={onClose}>
      <div className="space-y-3">
        {showOneMin ? <Field label="1-minute output weight (kg)" value={oneMin} onChange={setOneMin} /> : null}
        {fields.map((f) => <Field key={f.id} label={`${f.label}${f.unit ? ` (${f.unit})` : ""}`} value={vals[f.field_key]} onChange={(v) => setVals((x) => ({ ...x, [f.field_key]: v }))} />)}
        <p className="text-xs text-slate-500">Entered by {personName(D, reading.by)}. The change is logged with the old values.</p>
        <ErrorText text={error} />
        <div className="flex justify-end gap-2"><Button kind="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>Save</Button></div>
      </div>
    </Modal>
  );
}
