import { useState } from "react";
import { useData } from "../lib/data";
import { useAuth } from "../lib/auth";
import { cls } from "../lib/util";
import { Badge, Button, Card, Check, ErrorText, Field, Modal, Table, TextArea, Td, useRun } from "../components/ui";
import type { Data } from "../shared/types";
import { batchCode, batchMaterial, batchTickets, briquetteKg, fieldsFor, pelletKg, personName } from "../shared/rules";
import { fmtDuration, fmtTime, HOUR, shiftWindow, type Row } from "../shared/time";
import { addBags, addGreasing, addReading, lastBagCountTo, pelletProduct, readingFields, reportProblem, yardEmpty, yardStart } from "../lib/operator";

const ms = (v: unknown) => new Date(String(v)).getTime();
const overlap = (a: number, b: number, c: number, d: number) => Math.max(0, Math.min(b, d) - Math.max(a, c));
const tons = (kg: number) => `${(kg / 1000).toFixed(2)} t`;

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

/** The paper log sheet for this shift, one machine at a time. Management corrects entries; the operator adds readings. */
export function SheetPanel({ D, m, running, onReading, onGreasing }: { D: Data; m: Row; running: boolean; onReading: () => void; onGreasing: () => void }) {
  const nowMs = Date.now();
  const w = shiftWindow(D.shift);
  const from = w ? w.start : new Date(nowMs - 8 * 3_600_000);
  const to = w ? w.end : new Date(nowMs);
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const upto = new Date(Math.min(toMs, nowMs));

  const rFields = readingFields(D, m);
  const pFields = fieldsFor(D, m.stage, "prestart");
  const gFields = fieldsFor(D, m.stage, "greasing");
  const hasSheet = rFields.length > 0 || pFields.length > 0 || gFields.length > 0;
  if (!hasSheet) {
    return (
      <Card>
        <h2 className="font-semibold">No log sheet for this machine</h2>
        <p className="text-sm text-slate-500">Start, stop and problems are all that is recorded for the {String(m.name).toLowerCase()}.</p>
      </Card>
    );
  }

  const runs = D.machine_run
    .filter((r) => r.machine_id === m.id && overlap(ms(r.started_at), r.stopped_at ? ms(r.stopped_at) : nowMs, fromMs, toMs) > 0)
    .sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)));
  const runMs = runs.reduce((n, r) => n + overlap(ms(r.started_at), r.stopped_at ? ms(r.stopped_at) : nowMs, fromMs, toMs), 0);
  const lastRun = runs[runs.length - 1];
  const operators = [...new Set(runs.map((r) => String(r.operator_id)))];
  const inCharge = D.shift_in_charge.find((s) => ms(s.shift_start) === fromMs)?.person_id;
  const readings = D.log_reading.filter((r) => r.machine_id === m.id && ms(r.at) >= fromMs && ms(r.at) < toMs).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const prodKg = m.stage === "pellet" ? pelletKg(D, from, upto)
    : m.stage === "briquette" ? briquetteKg(D, from, upto, m.id)
    : pelletKg(D, from, upto) + D.machine.filter((x) => x.stage === "briquette").reduce((n, x) => n + briquetteKg(D, from, upto, x.id), 0);
  const runH = runMs / HOUR;
  const checkRuns = runs.map((r) => ({ r, answers: D.prestart_answer.filter((a) => a.run_id === r.id) })).filter((x) => x.answers.length > 0);
  const greased = D.greasing_check.find((g) => g.machine_id === m.id && ms(g.shift_start) === fromMs);
  const breakdowns = D.downtime.filter((d) => d.machine_id === m.id && overlap(ms(d.started_at), d.ended_at ? ms(d.ended_at) : nowMs, fromMs, toMs) > 0);

  const cells = (r: Row) => {
    const out = rFields
      .filter((f) => r.vals?.[f.field_key] != null && r.vals?.[f.field_key] !== "")
      .map((f) => `${f.label} ${r.vals[f.field_key]}${f.unit ? ` ${f.unit}` : ""}`);
    if (m.stage === "briquette" && Number(r.one_min_kg) > 0) out.push(`= ${(Number(r.one_min_kg) * 0.06).toFixed(2)} t/h`);
    return out.join(" · ");
  };

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Log sheet · {String(m.tag)}</h2>
          <p className="text-sm text-slate-500">{from.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}{w ? ` · ${w.shift.name} shift` : ""}</p>
        </div>
        {rFields.length ? <Button disabled={!running} onClick={onReading}>Add reading</Button> : null}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Kv label="Start" value={runs.length ? fmtTime(new Date(Math.max(ms(runs[0].started_at), fromMs)).toISOString()) : "-"} />
        <Kv label="End" value={!lastRun ? "-" : !lastRun.stopped_at ? "Running" : ms(lastRun.stopped_at) <= toMs ? fmtTime(String(lastRun.stopped_at)) : fmtTime(to.toISOString())} />
        <Kv label="In-charge" value={inCharge ? personName(D, String(inCharge)) : "Not set"} />
        <Kv label="Operator" value={operators.length ? operators.map((p) => personName(D, p)).join(", ") : "-"} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3 rounded-lg bg-slate-50 p-3 text-sm">
        <Kv label="Run hours" value={fmtDuration(runMs)} />
        <Kv label="Total prod." value={tons(prodKg)} />
        <Kv label="Avg prod." value={runH > 0 ? `${(prodKg / 1000 / runH).toFixed(2)} t/h` : "-"} />
      </div>

      {rFields.length ? (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold">{`Hourly readings · ${readings.length}`}</h3>
          <Table head={["Time", "By", "Readings"]} empty="No readings this shift yet.">
            {readings.map((r) => (
              <tr key={String(r.id)}>
                <Td>{fmtTime(String(r.at))}</Td>
                <Td>{personName(D, String(r.by))}</Td>
                <Td>{cells(r)}</Td>
              </tr>
            ))}
          </Table>
        </div>
      ) : null}

      {pFields.length ? (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold">Checks before starting</h3>
          {checkRuns.length === 0 ? <p className="text-sm text-slate-500">No start this shift yet.</p> : null}
          <ul className="space-y-1 text-sm">
            {checkRuns.map(({ r, answers }) => {
              const no = answers.filter((a) => a.answer === false).map((a) => String(D.log_field.find((f) => f.id === a.field_id)?.label ?? "?"));
              const remark = D.run_bypass.find((b) => b.run_id === r.id)?.remark;
              return (
                <li key={String(r.id)} className="flex flex-wrap items-center gap-2">
                  <b>{fmtTime(String(r.started_at))}</b>
                  <span className="text-slate-500">{personName(D, String(r.operator_id))}</span>
                  {no.length ? <Badge tone="bad">{`No: ${no.join(", ")}`}</Badge> : <Badge tone="good">All yes</Badge>}
                  {remark ? <span className="text-red-700">Bypass remark: "{String(remark)}"</span> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {gFields.length ? (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Greasing (once a shift)</h3>
            {greased ? <Badge tone="good">{`Done ${fmtTime(String(greased.at))}`}</Badge> : <Badge tone="warn">Due</Badge>}
          </div>
          {greased ? (
            <ul className="text-sm">
              {gFields.map((f) => (
                <li key={String(f.id)} className="flex justify-between"><span>{String(f.label)}</span><span className="font-semibold">{greased.vals?.[f.field_key] ?? "-"}{f.unit ? ` ${f.unit}` : ""}</span></li>
              ))}
            </ul>
          ) : (
            <Button kind="soft" onClick={onGreasing}>Record greasing</Button>
          )}
        </div>
      ) : null}

      <div className="mt-4">
        <h3 className="mb-2 text-sm font-semibold">Breakdowns</h3>
        {breakdowns.length === 0 ? <p className="text-sm text-slate-500">None this shift.</p> : null}
        <ul className="space-y-1 text-sm">
          {breakdowns.map((d) => (
            <li key={String(d.id)} className="flex flex-wrap gap-2">
              <b>{fmtTime(String(d.started_at))}-{d.ended_at ? fmtTime(String(d.ended_at)) : "now"}</b>
              <span className="text-slate-500">{String(D.stop_reason.find((s) => s.id === d.stop_reason_id)?.name ?? "")}</span>
              <span className="ml-auto text-slate-500">{fmtDuration((d.ended_at ? ms(d.ended_at) : nowMs) - ms(d.started_at))}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

/** One hourly reading. On the briquette machine the 1-minute output weight is required every hour. */
export function ReadingDialog({ m, runId, onClose }: { m: Row; runId: string; onClose: () => void }) {
  const { D, reload } = useData();
  const { session } = useAuth();
  const { busy, error, run } = useRun(reload);
  const [vals, setVals] = useState<Record<string, string>>({});
  const fields = readingFields(D, m);
  const oneMin = Number(vals.oneMin);

  return (
    <Modal title={`Add reading · ${m.tag}`} onClose={onClose}>
      <div className="space-y-3">
        {fields.map((f) => (
          <Field key={String(f.id)} label={`${f.label}${f.unit ? ` (${f.unit})` : ""}${f.required ? " *" : ""}`} value={vals[f.field_key] ?? ""} onChange={(v) => setVals((x) => ({ ...x, [f.field_key]: v }))} />
        ))}
        {m.stage === "briquette" ? <p className="text-sm text-slate-600">{oneMin > 0 ? `${oneMin} kg a minute = ${(oneMin * 0.06).toFixed(2)} t per hour.` : "Weigh one minute of output. It is needed every hour."}</p> : null}
        <ErrorText text={error} />
        <Button disabled={busy} onClick={() => run(async () => { await addReading(D, m, runId, session!.person.id, vals); onClose(); })}>Save reading</Button>
      </div>
    </Modal>
  );
}

export function GreasingDialog({ m, onClose }: { m: Row; onClose: () => void }) {
  const { D, reload } = useData();
  const { session } = useAuth();
  const { busy, error, run } = useRun(reload);
  const [vals, setVals] = useState<Record<string, string>>({});
  return (
    <Modal title={`Greasing · ${m.tag}`} onClose={onClose}>
      <div className="space-y-3">
        {fieldsFor(D, m.stage, "greasing").map((f) => (
          <Field key={String(f.id)} label={`${f.label}${f.unit ? ` (${f.unit})` : ""}`} value={vals[f.field_key] ?? ""} onChange={(v) => setVals((x) => ({ ...x, [f.field_key]: v }))} />
        ))}
        <ErrorText text={error} />
        <Button disabled={busy} onClick={() => run(async () => { await addGreasing(D, m, session!.person.id, vals); onClose(); })}>Save greasing</Button>
      </div>
    </Modal>
  );
}

/** Pellet bags counted into the store since the last count. */
export function BagsDialog({ onClose }: { onClose: () => void }) {
  const { D, reload } = useData();
  const { session } = useAuth();
  const { busy, error, run } = useRun(reload);
  const pellet = pelletProduct(D);
  const [bags, setBags] = useState("");
  const [kg, setKg] = useState(pellet?.bag_kg ? String(Number(pellet.bag_kg)) : "25");
  const since = new Date(lastBagCountTo(D)).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <Modal title="Pellet bag count" onClose={onClose}>
      <div className="space-y-3">
        {pellet ? <p className="text-sm text-slate-600">Bags counted into the store since {since}.</p> : <p className="text-sm text-amber-700">No pellet product is set up.</p>}
        <Field label="Bags" value={bags} onChange={(v) => setBags(v.replace(/\D/g, ""))} />
        <Field label="kg per bag" value={kg} onChange={setKg} />
        {bags ? <p className="font-semibold">{(Number(bags) * Number(kg || 0)).toLocaleString("en-US")} kg</p> : null}
        <ErrorText text={error} />
        <Button disabled={busy || !pellet} onClick={() => run(async () => { await addBags(D, session!.person.id, bags, kg); onClose(); })}>Save count</Button>
      </div>
    </Modal>
  );
}

const PRESETS = ["Strange noise", "Overheating", "Vibration", "Leak", "Electrical fault", "Blockage", "Other"];

/** Report a problem: goes straight to the fitters. */
export function ProblemDialog({ machineId, onClose }: { machineId: string; onClose: () => void }) {
  const { D, reload } = useData();
  const { session } = useAuth();
  const { busy, error, run } = useRun(reload);
  const [mid, setMid] = useState<string | null>(machineId);
  const [preset, setPreset] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [stopped, setStopped] = useState(false);
  const chip = (on: boolean) => cls("rounded-xl border px-3 py-2 text-left text-sm", on ? "border-brand-600 bg-brand-50" : "border-slate-300 bg-white hover:bg-slate-50");
  return (
    <Modal title="Report a problem" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">Goes straight to the fitters.</p>
        <div>
          <h3 className="mb-2 text-sm font-semibold">Machine</h3>
          <div className="flex flex-wrap gap-2">
            {[...D.machine].sort((a, b) => String(a.tag).localeCompare(String(b.tag))).map((x) => (
              <button key={String(x.id)} type="button" aria-pressed={x.id === mid} onClick={() => setMid(String(x.id))} className={chip(x.id === mid)}>
                <div className="font-semibold">{String(x.tag)}</div>
                <div className="text-xs text-slate-500">{String(x.name)}</div>
              </button>
            ))}
          </div>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold">What is wrong</h3>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => <button key={p} type="button" aria-pressed={p === preset} onClick={() => setPreset(p)} className={chip(p === preset)}>{p}</button>)}
          </div>
        </div>
        <TextArea label="More detail (optional)" value={note} onChange={setNote} />
        <Check label="The machine cannot run until this is fixed" value={stopped} onChange={setStopped} />
        <ErrorText text={error} />
        <Button disabled={busy} onClick={() => run(async () => { await reportProblem(session!.person.id, mid, preset, note, stopped); onClose(); })}>Send to fitters</Button>
      </div>
    </Modal>
  );
}

/** The operator at the chipper, wet hammer mill or dryer marks when he starts and empties a yard. */
export function YardsPanel({ D, m }: { D: Data; m: Row }) {
  const { reload } = useData();
  const { session } = useAuth();
  const me = session!.person.id;
  const { busy, error, run } = useRun(reload);
  const batches = D.yard_batch
    .filter((b) => !b.finished_at && batchTickets(D, String(b.id)).length > 0 && batchMaterial(D, b)?.feed_stage === m.stage)
    .sort((a, b) => batchCode(D, a).localeCompare(batchCode(D, b)));
  return (
    <Card>
      <h2 className="font-semibold">Yards for {String(m.name)}</h2>
      {batches.length === 0 ? <p className="mt-1 text-sm text-slate-500">No yard is waiting for this machine.</p> : null}
      <ul className="mt-2 space-y-3">
        {batches.map((b) => (
          <li key={String(b.id)} className="flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold">{batchCode(D, b)} · {String(batchMaterial(D, b)?.name ?? "")}</div>
              <div className="text-sm text-slate-500">
                {batchTickets(D, String(b.id)).length} trucks{b.closed_at ? " · closed" : " · filling"}{b.started_at ? ` · feeding since ${fmtTime(String(b.started_at))}` : ""}
              </div>
            </div>
            {b.started_at ? (
              <Button kind="danger" disabled={busy} onClick={() => { if (window.confirm(`Mark ${batchCode(D, b)} empty?`)) run(() => yardEmpty(String(b.id), me)); }}>Empty</Button>
            ) : (
              <Button disabled={busy} onClick={() => run(() => yardStart(String(b.id), me))}>Start feeding</Button>
            )}
          </li>
        ))}
      </ul>
      <ErrorText text={error} />
    </Card>
  );
}