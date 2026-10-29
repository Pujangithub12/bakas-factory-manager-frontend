import { useEffect, useMemo, useState } from "react";
import { useData } from "../lib/data";
import { useAuth } from "../lib/auth";
import { newId, push } from "../lib/api";
import { Badge, Button, Card, ErrorText, Field, Modal, PageHeader, Select, Table, TextArea, Td, useRun } from "../components/ui";
import { DAY, dayLabel, dayStartOf, hoursFmt, inputToIso, isoToInput } from "../lib/util";
import { machineAlerts, machineStatus, personName } from "../shared/rules";
import { fmtDateTime, fmtTime, type Row } from "../shared/time";

type Seg = { start: number; end: number; kind: "run" | "down" | "planned"; label: string };

export default function Machines() {
  const { D, reload, needDays } = useData();
  const { session } = useAuth();
  const canEdit = session!.roles.some((r) => r === "Owner" || r === "Manager");
  const [day, setDay] = useState(dayLabel(new Date()));
  const [editing, setEditing] = useState<Row | "new" | null>(null);

  const dayStart = dayStartOf(day).getTime();
  const dayEnd = dayStart + DAY;
  const now = Date.now();
  useEffect(() => needDays(Math.ceil((Date.now() - dayStart) / DAY) + 2), [dayStart, needDays]);

  const machines = useMemo(() => [...D.machine].sort((a, b) => a.tag.localeCompare(b.tag)), [D.machine]);

  const segs = (m: Row): Seg[] => {
    const out: Seg[] = [];
    const runs = D.machine_run.filter((r) => r.machine_id === m.id).sort((a, b) => a.started_at.localeCompare(b.started_at));
    runs.forEach((r, i) => {
      const s = new Date(r.started_at).getTime();
      const e = r.stopped_at ? new Date(r.stopped_at).getTime() : now;
      out.push({ start: s, end: e, kind: "run", label: `${personName(D, r.operator_id)} ${fmtTime(r.started_at)}-${r.stopped_at ? fmtTime(r.stopped_at) : "now"}` });
      const reason = D.stop_reason.find((x) => x.id === r.stop_reason_id);
      if (r.stopped_at && reason?.type === "Planned") {
        const next = runs[i + 1];
        out.push({ start: e, end: next ? new Date(next.started_at).getTime() : Math.min(now, dayEnd), kind: "planned", label: `${reason.name} ${fmtTime(r.stopped_at)}` });
      }
    });
    for (const d of D.downtime.filter((x) => x.machine_id === m.id)) {
      const reason = D.stop_reason.find((x) => x.id === d.stop_reason_id)?.name ?? "Down";
      out.push({ start: new Date(d.started_at).getTime(), end: d.ended_at ? new Date(d.ended_at).getTime() : now, kind: "down", label: `${reason} ${fmtTime(d.started_at)}-${d.ended_at ? fmtTime(d.ended_at) : "now"}` });
    }
    return out.filter((s) => s.end > dayStart && s.start < dayEnd);
  };

  const dayRuns = D.machine_run
    .filter((r) => {
      const s = new Date(r.started_at).getTime();
      const e = r.stopped_at ? new Date(r.stopped_at).getTime() : now;
      return e > dayStart && s < dayEnd;
    })
    .sort((a, b) => b.started_at.localeCompare(a.started_at));

  const color = { run: "bg-emerald-600", down: "bg-red-600", planned: "bg-slate-400" };

  return (
    <div>
      <PageHeader title="Machines" sub="What every machine is doing now and did each day.">
        <Field label="" type="date" value={day} onChange={setDay} />
        {canEdit ? <Button onClick={() => setEditing("new")}>Add a run</Button> : null}
      </PageHeader>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {machines.map((m) => {
          const st = machineStatus(D, m);
          return (
            <Card key={m.id}>
              <div className="flex items-start justify-between">
                <div><div className="font-bold">{m.tag}</div><div className="text-sm text-slate-500">{m.name}</div></div>
                <Badge tone={st.state === "running" ? "good" : st.state === "down" ? "bad" : "mute"}>{st.state === "running" ? "Running" : st.state === "down" ? "Down" : "Idle"}</Badge>
              </div>
              {st.run ? <p className="mt-2 text-sm">{st.operator?.full_name} since {fmtTime(st.run.started_at)}</p> : null}
              {st.state === "down" ? <p className="mt-2 text-sm text-red-700">{st.reason}</p> : null}
              <div className="mt-2 flex flex-wrap gap-1">{machineAlerts(D, m).map((a) => <Badge key={a.key} tone={a.tone === "bad" ? "bad" : "warn"}>{a.text}</Badge>)}</div>
            </Card>
          );
        })}
      </div>

      <h2 className="mb-2 font-semibold">Timeline for production day {day} <span className="text-sm font-normal text-slate-500">(06:00 to 06:00)</span></h2>
      <Card className="mb-2">
        <div className="relative mb-1 ml-28 h-4 text-[10px] text-slate-400">
          {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => <span key={h} className="absolute" style={{ left: `${(h / 24) * 100}%` }}>{String((6 + h) % 24).padStart(2, "0")}:00</span>)}
        </div>
        {machines.map((m) => (
          <div key={m.id} className="mb-1.5 flex items-center">
            <div className="w-28 shrink-0 text-sm font-semibold">{m.tag}</div>
            <div className="relative h-6 flex-1 rounded bg-slate-100">
              {segs(m).map((s, i) => {
                const l = Math.max(0, (s.start - dayStart) / DAY) * 100;
                const w = (Math.min(s.end, dayEnd) - Math.max(s.start, dayStart)) / DAY * 100;
                return <div key={i} title={s.label} className={`absolute top-0 h-6 rounded ${color[s.kind]} ${s.kind === "down" ? "opacity-90" : ""}`} style={{ left: `${l}%`, width: `${Math.max(w, 0.4)}%` }} />;
              })}
            </div>
          </div>
        ))}
        <div className="ml-28 mt-3 flex gap-4 text-xs text-slate-600">
          <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded bg-emerald-600" />Running</span>
          <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded bg-slate-400" />Planned stop</span>
          <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded bg-red-600" />Breakdown / down</span>
        </div>
      </Card>

      <h2 className="mb-2 mt-6 font-semibold">Runs ({dayRuns.length})</h2>
      <Table head={["Machine", "Operator", "Helpers", "Started", "Stopped", "Run time", "Reason", "Notes", ""]} empty="No runs on this day.">
        {dayRuns.map((r) => {
          const m = D.machine.find((x) => x.id === r.machine_id);
          const end = r.stopped_at ? new Date(r.stopped_at).getTime() : now;
          return (
            <tr key={r.id}>
              <Td className="font-semibold">{m?.tag}</Td>
              <Td>{personName(D, r.operator_id)}</Td>
              <Td>{D.run_helper.filter((h) => h.run_id === r.id).map((h) => personName(D, h.person_id)).join(", ") || "-"}</Td>
              <Td>{fmtDateTime(r.started_at)}</Td>
              <Td>{r.stopped_at ? fmtDateTime(r.stopped_at) : <Badge tone="good">Running</Badge>}</Td>
              <Td>{hoursFmt(end - new Date(r.started_at).getTime())}</Td>
              <Td>{D.stop_reason.find((s) => s.id === r.stop_reason_id)?.name ?? "-"}</Td>
              <Td className="max-w-48 truncate">{r.notes}</Td>
              <Td>{canEdit ? <Button small kind="ghost" onClick={() => setEditing(r)}>Correct</Button> : null}</Td>
            </tr>
          );
        })}
      </Table>

      {editing ? <RunEditor run={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); }} /> : null}
    </div>
  );
}

function RunEditor({ run, onClose, onSaved }: { run: Row | null; onClose: () => void; onSaved: () => void }) {
  const { D } = useData();
  const { session } = useAuth();
  const [machineId, setMachineId] = useState(run?.machine_id ?? "");
  const [operatorId, setOperatorId] = useState(run?.operator_id ?? "");
  const [started, setStarted] = useState(isoToInput(run?.started_at));
  const [stopped, setStopped] = useState(isoToInput(run?.stopped_at));
  const [reasonId, setReasonId] = useState(run?.stop_reason_id ?? "");
  const [notes, setNotes] = useState(run?.notes ?? "");
  const { busy, error, run: go } = useRun(onSaved);

  const save = () =>
    go(async () => {
      if (!machineId || !operatorId || !started) throw new Error("Choose the machine, the operator and the start time");
      const s = inputToIso(started)!;
      const e = inputToIso(stopped);
      if (e && e <= s) throw new Error("The stop time must be after the start time");
      if (e && !reasonId) throw new Error("Choose why it stopped");
      await push([{
        table: "machine_run",
        data: {
          id: run?.id ?? newId(), machine_id: machineId, operator_id: operatorId, started_at: s, stopped_at: e,
          stop_reason_id: e ? reasonId : null, notes: notes.trim() || null, ...(run ? {} : { entered_by: session!.person.id }),
        },
      }], true);
    });

  return (
    <Modal title={run ? "Correct this run" : "Add a run"} onClose={onClose}>
      <div className="space-y-3">
        <Select label="Machine" value={machineId} onChange={setMachineId} options={D.machine.map((m) => ({ value: m.id, label: `${m.tag} ${m.name}` }))} />
        <Select label="Operator" value={operatorId} onChange={setOperatorId} options={D.person.filter((p) => p.active).map((p) => ({ value: p.id, label: p.full_name }))} />
        <Field label="Started (Nepal time)" type="datetime-local" value={started} onChange={setStarted} />
        <Field label="Stopped (empty while running)" type="datetime-local" value={stopped} onChange={setStopped} />
        <Select label="Stop reason" value={reasonId} onChange={setReasonId} options={D.stop_reason.map((s) => ({ value: s.id, label: s.name }))} />
        <TextArea label="Notes" value={notes} onChange={setNotes} />
        <p className="text-xs text-slate-500">The change is saved and the old values stay in the audit log.</p>
        <ErrorText text={error} />
        <div className="flex justify-end gap-2"><Button kind="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={busy}>Save</Button></div>
      </div>
    </Modal>
  );
}
