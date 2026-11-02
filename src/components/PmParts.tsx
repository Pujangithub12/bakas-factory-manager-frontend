import { useState, type ReactNode } from "react";
import { useData } from "../lib/data";
import { useAuth } from "../lib/auth";
import { newId, push, type WriteOp } from "../lib/api";
import { Badge, Button, ErrorText, Field, Modal, Select, useRun } from "./ui";
import { cls, inputToIso, isoToInput } from "../lib/util";
import { hasRole, isDaily, isManagement, lastDone, machineOf, meterNow, num, personName, pmDueText, pmEvery, pmState, rolesOf, round2, type PmState } from "../shared/rules";
import { dayLab, fmtDay, fmtDayLong, groupByDay, intf, pmEvents, pmNextAt, type PmEvent } from "../shared/plan";
import { fmtTime, nowIso, productionDayStart, type Row } from "../shared/time";

const ms = (v: any) => new Date(v).getTime();

/** Fitters and management mark plan tasks done (the server also lets operators write the record). */
export function useCanPm() {
  const { session } = useAuth();
  const roles = session!.roles;
  return hasRole(roles, "Fitter") || isManagement(roles);
}

export const PmPill = ({ s }: { s: PmState["st"] }) =>
  s === "over" ? <Badge tone="bad">Overdue</Badge> : s === "soon" ? <Badge tone="warn">Due soon</Badge> : s === "new" ? <Badge>No record</Badge> : <Badge>OK</Badge>;

/** Due line of a task: hours or days left, and when it was last done. */
export const dueLine = (t: Row, s: PmState) => pmDueText(t, s) + (s.last ? ` · last done ${dayLab(ms(s.last.done_at))}` : "");

/** When: the time, and the day too if it was before today's production day. */
export const whenText = (at: number) => fmtTime(new Date(at).toISOString()) + (at < productionDayStart().getTime() ? ` ${fmtDay(at)}` : "");

// ------------------------------------------------------------ task row ----

export function TaskRow({ t, act, compact, onDone, onHistory }: { t: Row; act?: boolean; compact?: boolean; onDone?: () => void; onHistory: () => void }) {
  const { D } = useData();
  const s = pmState(D, t);
  const nx = pmNextAt(D, t, Date.now(), s);
  return (
    <div className={cls("grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t border-slate-100 px-1 py-2 text-sm first:border-t-0", !compact && "md:grid-cols-[104px_minmax(0,1fr)_minmax(150px,auto)_auto]")}>
      <span className={cls("col-start-1 row-start-1", !compact && "md:row-auto")}><PmPill s={s.st} /></span>
      <span className={cls("col-span-3 row-start-2 min-w-0", !compact && "md:col-span-1 md:col-start-2 md:row-start-1")}>
        <b className="block">{t.task}</b>
        <small className="block text-slate-600">{t.equipment} · <span className="text-slate-500">{t.component}</span> · {pmEvery(t)}{t.lubricant ? ` · ${t.lubricant}` : ""}</small>
        {t.source ? <small className="block text-slate-400">{t.source}</small> : null}
      </span>
      <span className={cls("col-start-2 row-start-1 text-xs", !compact && "md:col-start-3 md:text-sm", s.st === "over" && "font-medium text-red-700", s.st === "soon" && "text-amber-800")}>
        {dueLine(t, s)}
        {nx && s.st !== "over" ? <><br /><small className="text-slate-400">about {fmtDay(nx)}</small></> : null}
      </span>
      <span className={cls("col-start-3 row-span-2 row-start-1", !compact && "md:col-start-4 md:row-span-1")}>
        {act && onDone ? <Button small onClick={onDone}>Done</Button> : <Button small kind="ghost" onClick={onHistory}>History</Button>}
      </span>
    </div>
  );
}

// ------------------------------------------------------------ dialogs ----

type Dlg = { k: "task"; id: string } | { k: "done"; id: string } | { k: "round" } | { k: "day"; at: number; match: (t: Row) => boolean } | null;

/** One place for the task detail, Mark done, Daily round and day-list dialogs. Render `node` once on the page. */
export function usePmDialogs() {
  const [dlg, setDlg] = useState<Dlg>(null);
  const close = () => setDlg(null);
  const node: ReactNode = !dlg ? null : dlg.k === "task" ? <TaskModal id={dlg.id} onClose={close} onDone={() => setDlg({ k: "done", id: dlg.id })} />
    : dlg.k === "done" ? <DoneModal id={dlg.id} onClose={close} />
    : dlg.k === "round" ? <RoundModal onClose={close} />
    : <DayModal at={dlg.at} match={dlg.match} onClose={close} onTask={(id) => setDlg({ k: "task", id })} />;
  return {
    node,
    openTask: (id: string) => setDlg({ k: "task", id }),
    openDone: (id: string) => setDlg({ k: "done", id }),
    openRound: () => setDlg({ k: "round" }),
    openDay: (at: number, match: (t: Row) => boolean) => setDlg({ k: "day", at, match }),
  };
}

/** The agenda list: events grouped by day, each a button that opens the task. */
export function Agenda({ ev, onTask }: { ev: PmEvent[]; onTask: (id: string) => void }) {
  const { D } = useData();
  const groups = groupByDay(ev);
  if (!groups.length) return <p className="py-6 text-center text-sm text-slate-500">Nothing in this period.</p>;
  return (
    <div>
      {groups.map((g) => (
        <div key={g.at} className="border-t border-slate-100 py-2 first:border-t-0">
          <b className="block text-sm">{fmtDayLong(g.at)}</b>
          {g.list.map((e, i) => (
            <button key={i} type="button" onClick={() => onTask(e.t.id)} className={cls("mt-1 block w-full whitespace-normal rounded border-l-[3px] px-2 py-1.5 text-left text-sm", chipTone[e.k])}>
              <b>{machineOf(D, e.t.machine_id)?.tag}</b> {e.t.component}: {e.t.task}
              {e.k === "done" ? ` · done by ${personName(D, e.by)}` : e.k === "over" ? " · overdue" : ""}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

export const chipTone: Record<string, string> = {
  over: "border-red-600 bg-red-50 text-red-800",
  soon: "border-amber-500 bg-amber-50 text-amber-900",
  done: "border-emerald-600 bg-emerald-50 text-emerald-900",
  plan: "border-slate-400 bg-slate-50 text-slate-800",
};

function DayModal({ at, match, onClose, onTask }: { at: number; match: (t: Row) => boolean; onClose: () => void; onTask: (id: string) => void }) {
  const { D } = useData();
  const ev = pmEvents(D, at, at + 86_400_000, match);
  return (
    <Modal title={fmtDayLong(at)} onClose={onClose}>
      <p className="mb-2 text-sm text-slate-500">{ev.length} maintenance task{ev.length === 1 ? "" : "s"}</p>
      <Agenda ev={ev} onTask={onTask} />
    </Modal>
  );
}

/** One task: what it is, when it is next due, its record. */
function TaskModal({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const { D } = useData();
  const canPm = useCanPm();
  const t = D.pm_task.find((x) => x.id === id);
  if (!t) return <Modal title="Task" onClose={onClose}><p className="text-sm text-slate-500">Task not found.</p></Modal>;
  const s = pmState(D, t);
  const nx = pmNextAt(D, t, Date.now(), s);
  const log = D.pm_done.filter((l) => l.task_id === id).sort((a, b) => ms(b.done_at) - ms(a.done_at));
  const m = machineOf(D, t.machine_id);
  const kv: [string, ReactNode][] = [
    ["Component", t.component],
    ["Next due", s.st === "over" ? <span className="font-semibold text-red-700">Now, overdue</span> : nx ? <>{fmtDayLong(nx)} <small className="text-slate-500">forecast</small></> : "—"],
    ["Hour meter", `${m?.tag ?? ""} ${intf(meterNow(D, t.machine_id))} h`],
    ...(t.lubricant ? [["Lubricant", t.lubricant] as [string, ReactNode]] : []),
    ["Source", t.source || "—"],
  ];
  return (
    <Modal title={t.task} onClose={onClose} wide>
      <p className="-mt-2 mb-3 text-sm text-slate-500">{t.equipment} · {pmEvery(t)}</p>
      <div className="mb-3 flex flex-wrap items-center gap-2"><PmPill s={s.st} /><span className="text-sm text-slate-500">{dueLine(t, s)}</span></div>
      <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-sm">
        {kv.map(([k, v]) => <div key={k} className="contents"><dt className="text-slate-500">{k}</dt><dd>{v}</dd></div>)}
      </dl>
      {canPm && !isDaily(t) ? <div className="mt-3"><Button onClick={onDone}>Mark done</Button></div> : null}
      <h3 className="mb-1 mt-4 font-semibold">History</h3>
      {log.length ? (
        <div className="divide-y divide-slate-100 text-sm">
          {log.map((l) => (
            <div key={l.id} className="flex items-baseline gap-3 py-1.5">
              <span className="w-16 shrink-0 text-slate-500">{dayLab(ms(l.done_at))}</span>
              <span className="min-w-0 flex-1">{personName(D, l.by)}<small className="block text-slate-500">{l.note ?? ""}{l.hour_meter ? ` · meter ${intf(num(l.hour_meter))} h` : ""}</small></span>
              <span className="text-slate-500">{fmtTime(l.done_at)}</span>
            </div>
          ))}
        </div>
      ) : <p className="py-3 text-center text-sm text-slate-500">No record yet.</p>}
    </Modal>
  );
}

/** Take a lubricant amount out of the store and write the task as done. The plan names the oil and amount ("Mobil XHP 222, 20 g"). */
function DoneModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { D, reload } = useData();
  const { session } = useAuth();
  const t = D.pm_task.find((x) => x.id === id);
  const me = session!.person.id;
  const lubes = D.store_item.filter((i) => i.kind !== "Tool");
  const fitters = D.person.filter((p) => p.active && hasRole(rolesOf(D, p.id), "Fitter", "Electrician"));
  const m = /(\d+(?:\.\d+)?)\s*(g|kg|L)\b/.exec(t?.lubricant ?? "");
  const guess = m ? lubes.find((i) => i.kind === "Lubricant" && String(t?.lubricant).toLowerCase().includes((String(i.name).split(" ")[1] ?? "#").toLowerCase())) : undefined;
  const [f, setF] = useState({
    at: isoToInput(new Date().toISOString()),
    by: fitters.some((p) => p.id === me) ? me : (fitters[0]?.id ?? me),
    note: "",
    itemId: guess?.id ?? "",
    qty: guess && m ? String(m[2] === "g" ? Number(m[1]) / 1000 : Number(m[1])) : "",
  });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: k === "qty" ? v.replace(/[^\d.]/g, "") : v }));
  const { busy, error, run } = useRun(reload);
  if (!t) return <Modal title="Task" onClose={onClose}><p className="text-sm text-slate-500">Task not found.</p></Modal>;
  const meter = meterNow(D, t.machine_id);

  const submit = async () => {
    const ok = await run(async () => {
      const at = inputToIso(f.at);
      if (!at || ms(at) > Date.now() + 5 * 60_000) throw new Error("Enter when it was done.");
      const it = lubes.find((i) => i.id === f.itemId);
      const n = Number(f.qty);
      if (it && !(n > 0)) throw new Error("Enter the quantity taken from the store");
      if (it && n > num(it.qty)) throw new Error(`Only ${num(it.qty)} ${it.unit} in the store`);
      const ops: WriteOp[] = [
        { table: "pm_done", data: { id: newId(), task_id: t.id, machine_id: t.machine_id, done_at: at, by: f.by, hour_meter: Math.round(meterNow(D, t.machine_id, ms(at)) * 10) / 10, minutes: null, note: f.note.trim() || null } },
      ];
      if (it) {
        ops.push(
          { table: "store_item", data: { id: it.id, qty: round2(num(it.qty) - n) } },
          { table: "store_movement", data: { id: newId(), item_id: it.id, type: "issue", qty: n, to_person_id: f.by, by: me, at, due_back: null, returned_at: null, condition: null, returned_by: null, note: `Maintenance plan: ${t.task}`, job_id: null, task_id: t.id, pr_id: null } },
        );
      }
      await push(ops);
    });
    if (ok) onClose();
  };

  return (
    <Modal title={`Done: ${t.task}`} onClose={onClose}>
      <p className="-mt-2 mb-3 text-sm text-slate-500">{t.equipment} · {pmEvery(t)}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Done at" type="datetime-local" value={f.at} onChange={set("at")} />
        <Select label="Done by" value={f.by} onChange={set("by")} placeholder="Choose" options={(fitters.length ? fitters : D.person.filter((p) => p.id === me)).map((p) => ({ value: p.id, label: p.full_name }))} />
        <div className="md:col-span-2"><Field label="Note (optional)" value={f.note} onChange={set("note")} placeholder="What was found, readings, parts" /></div>
        <Select label="Taken from the store (optional)" value={f.itemId} onChange={set("itemId")} placeholder="Nothing" options={lubes.map((i) => ({ value: i.id, label: `${i.name} (${num(i.qty)} ${i.unit} in store)` }))} />
        <Field label="Quantity" value={f.qty} onChange={set("qty")} hint={guess ? "From the plan. Change it to what was used." : undefined} />
      </div>
      <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">The hour meter now reads {intf(meter)} h on {machineOf(D, t.machine_id)?.tag}. It is stored with this record.</p>
      <div className="mt-3 space-y-3">
        <ErrorText text={error} />
        <div className="flex justify-end gap-2">
          <Button kind="ghost" onClick={onClose}>Close</Button>
          <Button disabled={busy} onClick={submit}>Mark done</Button>
        </div>
      </div>
    </Modal>
  );
}

/** Tick each daily check. Anything marked Problem goes to maintenance as a job. */
function RoundModal({ onClose }: { onClose: () => void }) {
  const { D, reload } = useData();
  const { session } = useAuth();
  const t0 = productionDayStart().getTime();
  const list = D.pm_task.filter(isDaily).sort((a, b) => String(a.equipment).localeCompare(String(b.equipment)));
  const doneNow = (t: Row) => { const l = lastDone(D, t.id); return !!l && ms(l.done_at) >= t0; };
  const [ans, setAns] = useState<Record<string, string>>(() => Object.fromEntries(list.filter(doneNow).map((t) => [t.id as string, "yes"])));
  const [note, setNote] = useState("");
  const { busy, error, run } = useRun(reload);

  const submit = async () => {
    const ok = await run(async () => {
      const ticked = list.filter((t) => ans[t.id]);
      if (!ticked.length) throw new Error("Tick at least one check.");
      const me = session!.person.id;
      const now = nowIso();
      const bad = ticked.filter((t) => ans[t.id] === "no");
      await push([
        ...ticked.map((t): WriteOp => ({ table: "pm_done", data: { id: newId(), task_id: t.id, machine_id: t.machine_id, done_at: now, by: me, hour_meter: Math.round(meterNow(D, t.machine_id) * 10) / 10, minutes: null, note: ans[t.id] === "no" ? "Problem" : "OK" } })),
        ...bad.map((t): WriteOp => ({ table: "maintenance_job", data: { id: newId(), kind: "problem", machine_id: t.machine_id, problem: `Daily round: ${t.task}`, note: note.trim() || null, when_needed: null, reported_by: me, reported_at: now, machine_stopped: false, downtime_id: null, fitter_id: null, started_at: null, fixed_at: null, work_done: null, parts_used: null } })),
      ]);
    });
    if (ok) onClose();
  };

  return (
    <Modal title="Daily round" onClose={onClose}>
      <p className="-mt-2 mb-3 text-sm text-slate-500">Tick each check. Anything marked Problem goes to maintenance as a job.</p>
      <div className="divide-y divide-slate-100">
        {list.map((t) => (
          <div key={t.id} role="radiogroup" aria-label={t.task} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span>{t.task}<small className="block text-xs text-slate-500">{t.equipment}{doneNow(t) ? " · done today" : ""}</small></span>
            <span className="flex shrink-0 gap-3">
              {([["yes", "OK"], ["no", "Problem"]] as const).map(([v, l]) => (
                <label key={v} className="flex cursor-pointer items-center gap-1">
                  <input type="radio" name={`rd-${t.id}`} className="accent-brand-700" checked={ans[t.id] === v} onChange={() => setAns((a) => ({ ...a, [t.id]: v }))} />{l}
                </label>
              ))}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3"><Field label="Problem details (if any)" value={note} onChange={setNote} placeholder="What is wrong" /></div>
      <div className="mt-3 space-y-3">
        <ErrorText text={error} />
        <div className="flex justify-end gap-2">
          <Button kind="ghost" onClick={onClose}>Close</Button>
          <Button disabled={busy} onClick={submit}>Save round</Button>
        </div>
      </div>
    </Modal>
  );
}
