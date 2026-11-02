import { useEffect, useMemo, useState } from "react";
import { useData } from "../lib/data";
import { Button, Card, Select, PageHeader } from "../components/ui";
import { Agenda, TaskRow, chipTone, useCanPm, usePmDialogs, whenText } from "../components/PmParts";
import { cls } from "../lib/util";
import { isDaily, lastDone, machineOf, meterNow, num, personName, pmState } from "../shared/rules";
import { runHours } from "../shared/money";
import { addMonths, calMonth, fmtH, hrsPerDay, intf, nptDate, nptMidnight, pmEvents, pmFreq, tnum, type PmEvent } from "../shared/plan";
import { productionDayStart, type Row } from "../shared/time";

const ms = (v: any) => new Date(v).getTime();
const VIEWS: [string, string][] = [["cal", "Calendar"], ["due", "Overdue and due soon"], ["all", "All tasks"], ["daily", "Daily round"]];
const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const Fig = ({ label, value, sub, alert }: { label: string; value: React.ReactNode; sub?: React.ReactNode; alert?: boolean }) => (
  <Card><div className="text-xs text-slate-500">{label}</div><div className={cls("font-display text-2xl font-bold", alert && "text-red-700")}>{value}</div>{sub ? <div className="text-xs text-slate-500">{sub}</div> : null}</Card>
);
const Sub = ({ children }: { children: React.ReactNode }) => <h3 className="mb-1 mt-4 font-semibold first:mt-0">{children}</h3>;

/** The maintenance plan: a calendar forecast from the hour meters, what is overdue or due soon, every task, the daily round. */
export default function MaintenancePlan() {
  const { D, needDays } = useData();
  const canPm = useCanPm();
  const dlg = usePmDialogs();
  const [q, setQ] = useState("");
  const [mach, setMach] = useState("");
  const [view, setView] = useState("cal");
  const [calM, setCalM] = useState<number | null>(null);
  useEffect(() => needDays(40), [needDays]);

  const now = Date.now();
  const t0 = productionDayStart().getTime();
  const needle = q.trim().toLowerCase();
  const match = useMemo(() => (t: Row) => {
    if (mach && t.machine_id !== mach) return false;
    if (!needle) return true;
    const m = machineOf(D, t.machine_id);
    return [t.component, t.equipment, t.task, t.lubricant, t.source, m?.tag, m?.name].join(" ").toLowerCase().includes(needle);
  }, [D, mach, needle]);

  const all = D.pm_task.filter((t) => !isDaily(t)).map((t) => ({ t, s: pmState(D, t) }));
  const daily = D.pm_task.filter(isDaily);
  const over = all.filter((x) => x.s.st === "over");
  const soon = all.filter((x) => x.s.st === "soon");
  const doneD = daily.filter((t) => { const l = lastDone(D, t.id); return !!l && ms(l.done_at) >= t0; }).length;
  const machines = [...new Set(D.pm_task.map((t) => t.machine_id as string))].map((id) => machineOf(D, id)).filter((m): m is Row => !!m).sort((a, b) => String(a.tag).localeCompare(String(b.tag)));

  const list = (view === "all" ? all : all.filter((x) => x.s.st === "over" || x.s.st === "soon")).filter((x) => match(x.t)).sort((p, r) => r.s.f - p.s.f);
  const groups: Record<string, Row[]> = {};
  for (const x of list) (groups[x.t.equipment] ??= []).push(x.t);

  const meters = D.machine
    .filter((m) => num(m.hour_meter_start) > 0 || D.hour_meter_reading.some((r) => r.machine_id === m.id))
    .sort((a, b) => String(a.tag).localeCompare(String(b.tag)));

  return (
    <div>
      <PageHeader title="Maintenance plan" sub="From the Andritz manuals (PM30 pellet mill, Multimill hammer mill, PCF cooler), the FOMA chipper instructions and the site lubrication list. Counted on each machine’s running hours or the calendar, whichever comes first." />
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <Fig label="Overdue" value={over.length} alert={over.length > 0} />
        <Fig label="Due soon" value={soon.length} sub="within 15%" />
        <Fig label="Daily round today" value={`${doneD} of ${daily.length}`} sub={doneD < daily.length && canPm ? <span className="mt-1 inline-block"><Button small onClick={dlg.openRound}>Do the round</Button></span> : "checks done"} />
        <Fig label="Tasks in the plan" value={D.pm_task.length} />
      </div>

      <Card className="mb-4">
        <div className="mb-3 flex flex-wrap items-end gap-x-3 gap-y-2">
          <label className="block min-w-[220px]">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Search a part, task or oil</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. bearing, gearbox, die, hammers" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600" />
          </label>
          <Select label="Machine" value={mach} onChange={setMach} placeholder="All machines" options={machines.map((m) => ({ value: m.id, label: `${m.tag} · ${m.name}` }))} />
          <div className="flex flex-wrap gap-1 md:ml-auto" role="radiogroup" aria-label="View">
            {VIEWS.map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={view === k} onClick={() => setView(k)}
                className={cls("rounded-full border px-3 py-1.5 text-sm font-medium", view === k ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")}>{l}</button>
            ))}
          </div>
        </div>

        {view === "cal" ? <Calendar calM={calM ?? calMonth(now).a} setCalM={setCalM} match={match} filtered={!!needle || !!mach} dlg={dlg} />
          : view === "daily" ? (
            <>
              <div>
                {daily.filter(match).map((t) => {
                  const l = lastDone(D, t.id);
                  const done = !!l && ms(l.done_at) >= t0;
                  return (
                    <div key={t.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1 border-t border-slate-100 px-1 py-2 text-sm first:border-t-0 md:grid-cols-[104px_minmax(0,1fr)_minmax(150px,auto)]">
                      <span>{done ? <span className="inline-block rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">Done today</span> : <span className="inline-block rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800">Not yet</span>}</span>
                      <span className="min-w-0"><b className="block">{t.task}</b><small className="block text-slate-600">{t.equipment} · <span className="text-slate-500">{t.component}</span> · {t.source}</small></span>
                      <span className="col-span-2 text-xs text-slate-500 md:col-span-1 md:text-sm">{l ? `Last ${whenText(ms(l.done_at))} · ${personName(D, l.by)}` : ""}</span>
                    </div>
                  );
                })}
              </div>
              {canPm ? <div className="mt-3"><Button onClick={dlg.openRound}>Do the daily round</Button></div> : null}
            </>
          ) : (
            <>
              {needle ? <p className="mb-2 text-sm text-slate-500">{list.length} task{list.length === 1 ? "" : "s"} for “{q.trim()}”.</p> : null}
              {Object.keys(groups).length ? Object.entries(groups).map(([g, ts]) => (
                <div key={g}>
                  <Sub>{g}</Sub>
                  <div>{ts.map((t) => <TaskRow key={t.id} t={t} act={canPm} onDone={() => dlg.openDone(t.id)} onHistory={() => dlg.openTask(t.id)} />)}</div>
                </div>
              )) : <p className="py-6 text-center text-sm text-slate-500">{needle ? "No task matches. Try another word, or pick All tasks." : "Nothing is due. Pick All tasks to see the whole plan."}</p>}
            </>
          )}
      </Card>

      <Card>
        <h2 className="font-semibold">Hour meters</h2>
        <p className="mb-3 text-sm text-slate-500">Running hours: the starting reading (Setup, machines) plus every hour logged since. Enter the real meter readings from the machines.</p>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2">
          {meters.map((m) => (
            <div key={m.id} className="flex flex-col gap-0.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left">
              <span className="text-xs font-semibold text-slate-500">{m.tag}</span>
              <b className="text-xl tabular-nums">{intf(meterNow(D, m.id))} h</b>
              <small className="text-xs text-slate-500">{fmtH(runHours(D, m.id, t0, now))} today · {tnum(hrsPerDay(D, m.id), 1)} h a day</small>
            </div>
          ))}
          {meters.length === 0 ? <p className="text-sm text-slate-500">No hour meter set up yet.</p> : null}
        </div>
      </Card>
      {dlg.node}
    </div>
  );
}

type Dlgs = ReturnType<typeof usePmDialogs>;

/** The month grid (7 columns) on wide screens, the agenda list on narrow ones, then the every-shift and every-day checks. */
function Calendar({ calM, setCalM, match, filtered, dlg }: { calM: number; setCalM: (n: number | null) => void; match: (t: Row) => boolean; filtered: boolean; dlg: Dlgs }) {
  const { D } = useData();
  const now = Date.now();
  const t0 = productionDayStart().getTime();
  const c = calMonth(calM, now);
  const ev = useMemo(() => pmEvents(D, c.a, c.b, match, now), [D, c.a, c.b, match]);
  const byDay: Record<number, PmEvent[]> = {};
  for (const e of ev) (byDay[nptDate(e.at).d] ??= []).push(e);
  const freq = D.pm_task.filter((t) => match(t) && pmFreq(D, t, now));
  const chip = (e: PmEvent, i: number) => (
    <button key={i} type="button" onClick={() => dlg.openTask(e.t.id)} title={`${e.t.equipment}: ${e.t.task}`}
      className={cls("block w-full truncate rounded border-l-[3px] px-1.5 py-0.5 text-left text-[11.5px] leading-snug", chipTone[e.k])}>
      <b>{machineOf(D, e.t.machine_id)?.tag}</b> {e.t.component}
    </button>
  );
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Button small kind="ghost" onClick={() => setCalM(addMonths(calM, -1))}>← Previous</Button>
        <h2 className="min-w-[150px] text-center">{c.label}</h2>
        <Button small kind="ghost" onClick={() => setCalM(addMonths(calM, 1))}>Next →</Button>
        {c.isCur ? null : <Button small kind="ghost" onClick={() => setCalM(null)}>This month</Button>}
        <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500 md:ml-auto">
          {([["bg-red-600", "Overdue"], ["bg-amber-500", "Due soon"], ["bg-slate-400", "Planned"], ["bg-emerald-600", "Done"]] as const).map(([b, l]) => (
            <span key={l} className="flex items-center gap-1"><i className={cls("inline-block h-2.5 w-2.5 rounded-sm", b)} />{l}</span>
          ))}
        </span>
      </div>
      <div className="hidden grid-cols-7 overflow-hidden rounded border-l border-t border-slate-200 md:grid">
        {WEEK.map((w) => <div key={w} className="border-b border-r border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{w}</div>)}
        {Array.from({ length: c.lead }, (_, i) => <div key={`b${i}`} className="min-h-[112px] border-b border-r border-slate-200 bg-slate-50/50" />)}
        {Array.from({ length: c.days }, (_, i) => {
          const d = i + 1;
          const L = byDay[d] ?? [];
          return (
            <div key={d} className={cls("flex min-h-[112px] min-w-0 flex-col gap-[3px] border-b border-r border-slate-200 px-1.5 pb-1.5 pt-1", c.isCur && d === c.today && "bg-brand-50", c.isCur && d < c.today && "opacity-60")}>
              <span className={cls("text-xs font-semibold tabular-nums", c.isCur && d === c.today ? "text-brand-700" : "text-slate-600")}>{d}</span>
              {L.slice(0, 4).map(chip)}
              {L.length > 4 ? <button type="button" className="px-1.5 text-left text-[11.5px] text-brand-700 hover:underline" onClick={() => dlg.openDay(nptMidnight(c.y, c.m, d), match)}>+{L.length - 4} more</button> : null}
            </div>
          );
        })}
      </div>
      <div className="md:hidden"><Agenda ev={ev} onTask={dlg.openTask} /></div>
      <p className="mt-2.5 text-[12.5px] text-slate-500">Dates for running-hour tasks are a forecast from last week’s running hours; they move when the machines run more or less. {ev.length} in this month{filtered ? " for this search" : ""}.</p>
      {freq.length ? (
        <>
          <Sub>Every shift or every day · {freq.length}</Sub>
          <div className="flex flex-wrap gap-1.5">
            {freq.map((t) => {
              const l = lastDone(D, t.id);
              const done = isDaily(t) ? !!l && ms(l.done_at) >= t0 : pmState(D, t).st !== "over";
              return (
                <button key={t.id} type="button" onClick={() => dlg.openTask(t.id)} className={cls("max-w-full truncate rounded border-l-[3px] px-2 py-1 text-left text-[12.5px]", done ? chipTone.done : chipTone.over)}>
                  <b>{machineOf(D, t.machine_id)?.tag}</b> {t.component}: {t.task}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

