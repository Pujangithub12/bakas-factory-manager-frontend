import { useEffect, useState } from "react";
import { useData } from "../lib/data";
import { useAuth } from "../lib/auth";
import { cls } from "../lib/util";
import { Badge, Button, Card, Check, ErrorText, Modal, PageHeader, Table, TextArea, Td, useRun } from "../components/ui";
import { blockingJob, busyPeople, canRun, fieldsFor, machineStatus, onSiteMap, openJobs, personName } from "../shared/rules";
import { fmtTime, shiftWindow } from "../shared/time";
import { startRun, stopRun } from "../lib/operator";
import { BagsDialog, GreasingDialog, ProblemDialog, ReadingDialog, SheetPanel, YardsPanel } from "./MyMachinesPanels";

const ms = (v: unknown) => new Date(String(v)).getTime();
const overlap = (a: number, b: number, c: number, d: number) => Math.max(0, Math.min(b, d) - Math.max(a, c));

/** The running time, ticking every second. It re-renders on its own so the rest of the page stays still. */
function Clock({ iso }: { iso: string }) {
  const [t, setT] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setT(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  const s = Math.max(0, Math.floor((t - ms(iso)) / 1000));
  const p = (n: number) => String(n).padStart(2, "0");
  return <>{`${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`}</>;
}

type Dialog = null | "start" | "stop" | "reading" | "grease" | "bags" | "problem";

/** The operator's machines on a laptop: pick a machine, start and stop it, and see this shift's runs. */
export default function MyMachines() {
  const { D, reload } = useData();
  const { session } = useAuth();
  const me = session!.person.id;
  const roles = session!.roles;
  const { busy, error, setError, run } = useRun(reload);
  const [sel, setSel] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

  // Start form
  const [answers, setAnswers] = useState<Record<string, boolean | null>>({});
  const [helpers, setHelpers] = useState<string[]>([]);
  const [runAnyway, setRunAnyway] = useState(false);
  const [remark, setRemark] = useState("");
  // Stop form
  const [reasonId, setReasonId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const machines = D.machine.filter((m) => canRun(D, me, m, roles)).sort((a, b) => String(a.tag).localeCompare(String(b.tag)));
  const here = onSiteMap(D).has(me);
  const w = shiftWindow(D.shift);
  const inCharge = w ? D.shift_in_charge.find((s) => ms(s.shift_start) === w.start.getTime()) : undefined;
  const header = <PageHeader title={`Hello, ${session!.person.full_name}`} sub={`${w ? `${w.shift.name} shift` : "Off-shift"} · in-charge ${inCharge ? personName(D, String(inCharge.person_id)) : "not set"}. Your machines:`} />;
  const gate = !here ? <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">You are not checked in at the gate.</p> : null;

  if (machines.length === 0) {
    return (
      <div>
        {header}
        {gate}
        <p className="text-slate-600">You are not set up on any machine yet. The supervisor ticks your machines on Shift & crew.</p>
      </div>
    );
  }

  const mineRunning = D.machine_run.find((r) => !r.stopped_at && r.operator_id === me)?.machine_id;
  const m = machines.find((x) => x.id === sel) ?? machines.find((x) => x.id === mineRunning) ?? machines[0];
  const st = machineStatus(D, m);
  const blocking = blockingJob(D, m.id as string);
  const mine = !!st.run && st.run.operator_id === me;
  const lockedBy = st.run && !mine ? st.operator?.full_name : null;
  const ok = here && !lockedBy;

  const openDown = D.downtime.find((d) => d.machine_id === m.id && !d.ended_at);
  const planned = st.state === "down" && D.stop_reason.find((r) => r.id === openDown?.stop_reason_id)?.type === "Planned";
  const tone = st.run ? "border-t-emerald-600" : st.state === "down" ? (planned ? "border-t-amber-500" : "border-t-red-600") : "border-t-slate-400";
  const word = st.run ? (st.bypass ? "On bypass" : "Running") : st.state === "down" ? (planned ? "Stopped" : "Down") : "Stopped";
  const reportedJob = openJobs(D, m.id as string).find((j) => !j.machine_stopped && j.kind !== "bypass");
  const helperNames = st.run ? D.run_helper.filter((h) => h.run_id === st.run!.id).map((h) => personName(D, String(h.person_id))) : [];

  // This shift's runs: mine, or ones I helped with.
  const nowMs = Date.now();
  const from = w ? w.start.getTime() : nowMs - 8 * 3_600_000;
  const to = w ? w.end.getTime() : nowMs;
  const helped = new Set(D.run_helper.filter((h) => h.person_id === me).map((h) => String(h.run_id)));
  const runs = D.machine_run
    .filter((r) => (r.operator_id === me || helped.has(String(r.id))) && overlap(ms(r.started_at), r.stopped_at ? ms(r.stopped_at) : nowMs, from, to) > 0)
    .sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));

  // Start form values
  const prestart = fieldsFor(D, m.stage, "prestart");
  const busyIds = busyPeople(D);
  const crew = [...onSiteMap(D).keys()].filter((id) => id !== me && !busyIds.has(id));
  const failed = prestart.filter((f) => answers[f.id] === false);
  const allAnswered = prestart.every((f) => answers[f.id] === true || answers[f.id] === false);
  const ready = allAnswered && (failed.length === 0 || (runAnyway && remark.trim().length > 0));
  const reason = D.stop_reason.find((r) => r.id === reasonId);

  const feedStage = D.material.some((x) => x.feed_stage === m.stage);

  const openDialog = (d: Dialog) => {
    setError(null);
    setAnswers({});
    setHelpers([]);
    setRunAnyway(false);
    setRemark("");
    setReasonId(null);
    setNote("");
    setDialog(d);
  };
  const close = () => { setDialog(null); setError(null); };

  return (
    <div>
      {header}
      {gate}

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Your machines">
        {machines.map((x) => {
          const s = machineStatus(D, x).state;
          return (
            <button
              key={x.id}
              type="button"
              onClick={() => setSel(x.id as string)}
              aria-pressed={x.id === m.id}
              className={cls("rounded-xl border px-4 py-2 text-left text-sm", x.id === m.id ? "border-brand-600 bg-brand-50" : "border-slate-300 bg-white hover:bg-slate-50")}
            >
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{String(x.tag)}</div>
              <div className="flex items-center gap-2 font-semibold">
                <span className={cls("inline-block h-2.5 w-2.5 rounded-full", s === "running" ? "bg-emerald-600" : s === "down" ? "bg-red-600" : "bg-slate-400")} />
                {String(x.name)}
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
        <Card className={cls("border-t-4", tone)}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{String(m.tag)}</div>
              <div className="font-display text-3xl font-bold leading-tight">{String(m.name)}</div>
            </div>
            <Badge tone={st.run ? (st.bypass ? "bad" : "good") : st.state === "down" ? (planned ? "warn" : "bad") : "mute"}>{word}</Badge>
          </div>

          <div className="mt-4 font-display text-5xl font-bold tracking-tight">
            {st.run ? <Clock iso={String(st.run.started_at)} /> : st.state === "down" && !planned ? "Down" : "Stopped"}
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {st.run
              ? `Running since ${fmtTime(String(st.run.started_at))} · ${mine ? "you" : st.operator?.full_name}${helperNames.length ? ` + ${helperNames.join(", ")}` : ""}`
              : st.state === "down"
                ? `${st.reason ?? "Down"}${openDown ? ` since ${fmtTime(String(openDown.started_at))}` : ""}${blocking ? ` · ${blocking.started_at ? `${personName(D, String(blocking.fitter_id))} is on it` : "waiting for a fitter"}` : ""}`
                : "Idle"}
          </p>

          {st.bypass ? <p className="mt-2 text-sm font-medium text-red-700">Running on bypass. A job is open for maintenance.</p> : null}
          {reportedJob ? (
            <p className="mt-2 text-sm text-amber-700">
              {String(reportedJob.problem)} reported {fmtTime(String(reportedJob.reported_at))}
              {reportedJob.fitter_id ? ` · ${personName(D, String(reportedJob.fitter_id))} on it` : ""}
            </p>
          ) : null}
          {lockedBy ? <p className="mt-2 text-sm text-amber-700">Running machine of {lockedBy}. Others can only report a problem on it.</p> : null}
          {st.state === "down" && blocking ? <p className="mt-2 text-sm text-red-700">It cannot start until the job is fixed.</p> : null}

          <div className="mt-4 flex flex-wrap gap-2">
            {st.run ? (
              <Button kind="danger" disabled={!ok || !mine} onClick={() => openDialog("stop")}>Stop machine</Button>
            ) : (
              <Button disabled={!ok || !!blocking} onClick={() => openDialog("start")}>Start machine</Button>
            )}
            {m.stage === "pellet" ? <Button kind="soft" disabled={!here} onClick={() => openDialog("bags")}>Record pellet bags</Button> : null}
            <Button kind="ghost" disabled={!here} onClick={() => openDialog("problem")}>Report a problem</Button>
          </div>
        </Card>

        <div>
          <h2 className="mb-2 font-semibold">Your runs this shift</h2>
          <Table head={["Machine", "Start", "Stop", "Reason"]} empty="Nothing yet this shift.">
            {runs.map((r) => (
              <tr key={String(r.id)}>
                <Td>{String(D.machine.find((x) => x.id === r.machine_id)?.tag ?? "?")}</Td>
                <Td>{fmtTime(String(r.started_at))}</Td>
                <Td>{r.stopped_at ? fmtTime(String(r.stopped_at)) : <Badge tone="good">Running</Badge>}</Td>
                <Td>{r.stopped_at ? String(D.stop_reason.find((x) => x.id === r.stop_reason_id)?.name ?? "") : ""}</Td>
              </tr>
            ))}
          </Table>
        </div>
        </div>

        <div className="space-y-4">
          <SheetPanel D={D} m={m} running={mine && !!st.run} onReading={() => openDialog("reading")} onGreasing={() => openDialog("grease")} />
          {feedStage ? <YardsPanel D={D} m={m} /> : null}
        </div>
      </div>

      {dialog === "reading" && st.run ? <ReadingDialog m={m} runId={String(st.run.id)} onClose={close} /> : null}
      {dialog === "grease" ? <GreasingDialog m={m} onClose={close} /> : null}
      {dialog === "bags" ? <BagsDialog onClose={close} /> : null}
      {dialog === "problem" ? <ProblemDialog machineId={String(m.id)} onClose={close} /> : null}

      {dialog === "start" ? (
        <Modal title={`Start ${m.tag}`} onClose={close}>
          <div className="space-y-4">
            <div>
              <h3 className="mb-2 text-sm font-semibold">Checks before start</h3>
              {prestart.length === 0 ? <p className="text-sm text-slate-500">No checks are set up for this machine.</p> : null}
              <div className="space-y-2">
                {prestart.map((f) => (
                  <div key={String(f.id)} className="flex items-center justify-between gap-3">
                    <span className="text-sm">{String(f.label)}</span>
                    <span className="flex gap-2">
                      <Button kind={answers[String(f.id)] === true ? "primary" : "ghost"} onClick={() => setAnswers((a) => ({ ...a, [String(f.id)]: true }))}>Yes</Button>
                      <Button kind={answers[String(f.id)] === false ? "danger" : "ghost"} onClick={() => setAnswers((a) => ({ ...a, [String(f.id)]: false }))}>No</Button>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {failed.length ? (
              <div className="space-y-2 rounded-lg bg-red-50 p-3">
                <p className="text-sm font-semibold text-red-700">A "No" blocks the start.</p>
                <Check label="Run anyway (goes to maintenance, shows as on bypass)" value={runAnyway} onChange={setRunAnyway} />
                {runAnyway ? <TextArea label="What is wrong and why it is safe to run" value={remark} onChange={setRemark} /> : null}
              </div>
            ) : null}

            <div>
              <h3 className="mb-2 text-sm font-semibold">Helpers (checked in, not on another machine)</h3>
              {crew.length === 0 ? <p className="text-sm text-slate-500">No one else is free.</p> : null}
              <div className="grid gap-1 sm:grid-cols-2">
                {crew.map((id) => (
                  <Check key={id} label={personName(D, id)} value={helpers.includes(id)} onChange={(v) => setHelpers((h) => (v ? [...h, id] : h.filter((x) => x !== id)))} />
                ))}
              </div>
            </div>

            <ErrorText text={error} />
            <Button disabled={busy || !ready} onClick={() => run(async () => { await startRun(D, m, me, answers, helpers, runAnyway, remark); close(); })}>Start machine</Button>
          </div>
        </Modal>
      ) : null}

      {dialog === "stop" && st.run ? (
        <Modal title={`Stop ${m.tag}`} onClose={close}>
          <div className="space-y-4">
            <div>
              <h3 className="mb-2 text-sm font-semibold">Why is it stopping?</h3>
              <div className="flex flex-wrap gap-2">
                {D.stop_reason.map((r) => (
                  <button
                    key={String(r.id)}
                    type="button"
                    onClick={() => setReasonId(String(r.id))}
                    aria-pressed={r.id === reasonId}
                    className={cls("rounded-xl border px-3 py-2 text-left text-sm", r.id === reasonId ? "border-brand-600 bg-brand-50" : "border-slate-300 bg-white hover:bg-slate-50")}
                  >
                    <div className="font-semibold">{String(r.name)}</div>
                    <div className="text-xs text-slate-500">{String(r.type)}</div>
                  </button>
                ))}
              </div>
              {D.stop_reason.length === 0 ? <p className="text-sm text-amber-700">No stop reasons are set up. Ask the Owner to add them in Setup lists, Stop reasons.</p> : null}
              {reason?.calls_maintenance ? <p className="mt-2 text-sm text-amber-700">A maintenance job will be opened. {reason.machine_down ? "The machine stays Down until it is fixed." : ""}</p> : null}
            </div>
            <TextArea label="Note (optional)" value={note} onChange={setNote} />
            <ErrorText text={error} />
            <Button kind="danger" disabled={busy || !reason} onClick={() => run(async () => { await stopRun(D, m, st.run!, me, reasonId, note); close(); })}>Stop machine</Button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}