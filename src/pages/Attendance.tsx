import { useEffect, useMemo, useState } from "react";
import { useData } from "../lib/data";
import { useAuth } from "../lib/auth";
import { clearMark, markAllPresent, saveMark } from "../lib/flows";
import { push } from "../lib/api";
import { cls } from "../lib/util";
import { Badge, Button, Card, ErrorText, Field, Modal, PageHeader, useRun } from "../components/ui";
import { ACCESS_LABEL, ATT_ACCESS_KEY, MARK_STATUSES, WEEKLY_OFF, accessList, attendanceAccess, attendanceIndex, attendancePeople, canMarkDay, dayCode, dayEntry, dayShare, defaultAccess, mainRole, personName, rolesOf, type AttAccess, type AttendanceIndex, type DayEntry, type MarkStatus } from "../shared/rules";
import { DAY, addDays, dayKey, fmtDayKey, fmtTime, nowIso, weekdayOf, type Row } from "../shared/time";

const CELL: Record<string, string> = {
  P: "bg-emerald-50 text-emerald-800", H: "bg-amber-50 text-amber-800", A: "bg-red-50 text-red-700",
  L: "bg-blue-50 text-blue-800", Off: "bg-slate-100 text-slate-500",
};
const cellTone = (e: DayEntry, code: string) => (e.status === "Present" ? CELL.P : CELL[code] ?? "");

type Status = MarkStatus | "Not marked";
/** Soft colour for a pill, strong colour for a selected button. */
const TONE: Record<Status, { soft: string; strong: string; bar: string }> = {
  Present: { soft: "bg-emerald-50 text-emerald-800 border-emerald-200", strong: "bg-emerald-700 text-white border-emerald-700", bar: "bg-emerald-600" },
  "Half day": { soft: "bg-amber-50 text-amber-800 border-amber-200", strong: "bg-amber-600 text-white border-amber-600", bar: "bg-amber-500" },
  Absent: { soft: "bg-red-50 text-red-700 border-red-200", strong: "bg-red-600 text-white border-red-600", bar: "bg-red-500" },
  Leave: { soft: "bg-blue-50 text-blue-800 border-blue-200", strong: "bg-blue-700 text-white border-blue-700", bar: "bg-blue-500" },
  Off: { soft: "bg-slate-100 text-slate-600 border-slate-200", strong: "bg-slate-600 text-white border-slate-600", bar: "bg-slate-400" },
  "Not marked": { soft: "bg-slate-50 text-slate-500 border-slate-200", strong: "bg-slate-500 text-white border-slate-500", bar: "bg-slate-300" },
};
const SHORT: Record<Status, string> = { Present: "Present", "Half day": "Half", Absent: "Absent", Leave: "Leave", Off: "Off", "Not marked": "Not marked" };
const WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function monthDays(month: string) {
  const out: string[] = [];
  for (let d = `${month}-01`; d.startsWith(month); d = addDays(d, 1)) out.push(d);
  return out;
}

/** A spreadsheet cell: quoted, and a name starting with = + - @ is not run as a formula by Excel. */
const csvCell = (v: string | number) => {
  const s = String(v);
  return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

export default function Attendance() {
  const { D, reload } = useData();
  const { session } = useAuth();
  const me = session!.person.id;
  const roles = session!.roles;
  const access = attendanceAccess(D, me, roles);
  const isOwner = roles.includes("Owner");
  // The server sends a year of history to management and a month to anyone else.
  const cap = roles.some((r) => r === "Owner" || r === "Manager" || r === "Supervisor") ? 400 : 31;
  const [tab, setTab] = useState<"daily" | "monthly">("daily");
  const [day, setDay] = useState(dayKey());
  const [accessOpen, setAccessOpen] = useState(false);
  const ix = useMemo(() => attendanceIndex(D), [D]);

  return (
    <div>
      <PageHeader title="Attendance" sub={access === "edit" ? "Fills itself from the gate. Mark or correct a day here." : "Fills itself from the gate. You can view it; the Owner decides who can mark it."}>
        {isOwner ? <Button kind="ghost" onClick={() => setAccessOpen(true)}>Access</Button> : null}
      </PageHeader>

      <div role="tablist" aria-label="Attendance view" className="mb-5 inline-flex rounded-xl bg-slate-100 p-1">
        {(["daily", "monthly"] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cls("rounded-lg px-5 py-2 text-sm font-semibold transition", tab === k ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:text-slate-800")}
          >
            {k === "daily" ? "Daily attendance" : "Monthly attendance"}
          </button>
        ))}
      </div>

      {tab === "daily" ? (
        <Daily ix={ix} access={access} cap={cap} day={day} setDay={setDay} />
      ) : (
        <Monthly ix={ix} access={access} cap={cap} onOpenDay={(d) => { setDay(d); setTab("daily"); }} />
      )}

      {accessOpen ? <AccessModal me={me} onClose={() => setAccessOpen(false)} onSaved={reload} /> : null}
    </div>
  );
}

// ------------------------------------------------------------- daily ----

function Daily({ ix, access, cap, day, setDay }: { ix: AttendanceIndex; access: AttAccess; cap: number; day: string; setDay: (d: string) => void }) {
  const { D, reload, needDays, loadedDays } = useData();
  const { session } = useAuth();
  const me = session!.person.id;
  const roles = session!.roles;
  const today = dayKey();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Status | null>(null);
  const [open, setOpen] = useState<{ p: Row; status?: MarkStatus } | null>(null);
  const { busy, error, run } = useRun(reload);

  // Any day this person receives can be looked at; marking keeps its own day limits.
  const oldest = addDays(today, -(cap - 2));
  const ago = Math.round((Date.parse(today) - Date.parse(day)) / DAY);
  const need = Math.min(cap, ago + 2);
  useEffect(() => needDays(need), [need, needDays]);
  const loaded = ago <= 1 || loadedDays >= need;

  const list = useMemo(
    () =>
      attendancePeople(D, ix, [day]).map((p) => {
        const e = dayEntry(ix, p, day);
        const status: Status | null = e.status;
        return { p, e, status };
      }),
    [D, ix, day, loaded],
  );
  const count = (s: Status) => list.filter((x) => x.status === s).length;
  const canEdit = canMarkDay(access, roles, day, today);
  const needle = q.trim().toLowerCase();
  const shown = list.filter((x) => (!filter || x.status === filter) && x.p.full_name.toLowerCase().includes(needle));
  const present = count("Present") + count("Half day") * 0.5;
  const expected = list.filter((x) => x.status && x.status !== "Off" && x.status !== "Leave").length;
  const pct = expected ? Math.round((present / expected) * 100) : 0;
  const stats: Status[] = ["Present", "Half day", "Not marked", "Absent", "Leave", "Off"];
  const label = day === today ? "Today" : day === addDays(today, -1) ? "Yesterday" : `${ago} days ago`;

  // One click marks. Tapping the current mark again removes it. A change against the gate asks for a reason first.
  const tap = (p: Row, e: DayEntry, s: MarkStatus) => {
    if (e.mark?.status === s) return run(() => clearMark(p.id, day));
    if (!e.mark && e.status === s) return;
    if (e.gate && s !== "Present") return setOpen({ p, status: s });
    return run(() => saveMark(p.id, day, s, "", me));
  };

  // "Mark all present" fills in only the people who are Not marked among those shown.
  // Marks already made by hand, gate entries and the Saturday Off are left as they are.
  const unmarked = shown.filter((x) => x.status === "Not marked");
  const markAll = () => {
    if (!unmarked.length) return;
    if (!window.confirm(`Mark ${unmarked.length} ${unmarked.length === 1 ? "person" : "people"} present for ${fmtDayKey(day)}?`)) return;
    run(() => markAllPresent(unmarked.map((x) => x.p.id), day, me));
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <Card className="flex flex-col justify-between gap-4">
          <div className="flex items-center gap-2">
            <button aria-label="Previous day" disabled={day <= oldest} onClick={() => setDay(addDays(day, -1))} className="grid h-10 w-10 place-items-center rounded-full text-2xl text-brand-700 hover:bg-slate-100 disabled:opacity-30">‹</button>
            <div className="flex-1 text-center">
              <div className="text-xs font-semibold uppercase tracking-widest text-slate-500">{WEEK[weekdayOf(day)]} · {label}</div>
              <div className="text-2xl font-bold text-slate-900">{fmtDayKey(day)}</div>
            </div>
            <button aria-label="Next day" disabled={day >= today} onClick={() => setDay(addDays(day, 1))} className="grid h-10 w-10 place-items-center rounded-full text-2xl text-brand-700 hover:bg-slate-100 disabled:opacity-30">›</button>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              aria-label="Day"
              value={day}
              min={oldest}
              max={today}
              onChange={(e) => e.target.value && e.target.value >= oldest && e.target.value <= today && setDay(e.target.value)}
              className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            />
            {day !== today ? <Button kind="soft" small onClick={() => setDay(today)}>Today</Button> : null}
          </div>
          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-sm font-semibold text-brand-700">{loaded ? `${present} of ${expected} at work` : "Loading this day..."}</span>
              <span className="text-2xl font-bold text-brand-700">{loaded ? `${pct}%` : ""}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-brand-700 transition-all" style={{ width: `${loaded ? pct : 0}%` }} />
            </div>
          </div>
        </Card>

        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {stats.map((s) => {
            const on = filter === s;
            return (
              <button
                key={s}
                onClick={() => setFilter(on ? null : s)}
                aria-pressed={on}
                title={`Show only ${s.toLowerCase()}`}
                className={cls("flex flex-col items-center justify-center rounded-2xl border p-3 transition hover:shadow-sm", on ? TONE[s].strong : cls("bg-white", TONE[s].soft.split(" ").filter((c) => !c.startsWith("bg-")).join(" ")))}
              >
                <span className="text-3xl font-bold">{count(s)}</span>
                <span className="text-xs font-semibold uppercase tracking-wide">{SHORT[s]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {access === "view" ? <p className="text-sm text-slate-500">You can view this sheet. Only people the Owner allows can mark it.</p> : null}
      {access === "edit" && !canEdit ? <p className="text-sm text-slate-500">You cannot mark this day. It is outside the days you may mark.</p> : null}

      <div className="flex flex-wrap items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name" aria-label="Search name" className="w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
        {filter ? <button onClick={() => setFilter(null)} className="text-sm font-semibold text-brand-700 hover:underline">Showing {SHORT[filter].toLowerCase()} only · Show all</button> : null}
        <span className="ml-auto text-xs text-slate-500">{shown.length} of {list.length} people</span>
        {canEdit ? (
          <Button disabled={busy || !loaded || unmarked.length === 0} onClick={markAll}>
            Mark all present{unmarked.length ? ` (${unmarked.length})` : ""}
          </Button>
        ) : null}
      </div>
      <ErrorText text={error} />

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Person</th>
              <th className="px-3 py-3">Gate in</th>
              <th className="px-3 py-3">Gate out</th>
              <th className="px-3 py-3">Status</th>
              <th className="px-3 py-3">{canEdit ? "Mark" : "Note"}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map(({ p, e, status }) => (
              <tr key={p.id} className="hover:bg-slate-50/60">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    <span className={cls("h-9 w-1 rounded-full", status ? TONE[status].bar : "bg-slate-200")} />
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#f2e6d8] text-xs font-bold text-brand-700">{initials(p.full_name)}</span>
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-slate-900">{p.full_name}</div>
                      <div className="text-xs text-slate-500">{mainRole(D, p.id) ?? "No role"}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5 tabular-nums">{e.gate ? fmtTime(e.gate.gate_in) : <span className="text-slate-400">—</span>}</td>
                <td className="px-3 py-2.5 tabular-nums">
                  {e.lastGate?.gate_out ? fmtTime(e.lastGate.gate_out) : e.noCheckout ? <span className="text-amber-700">No check-out</span> : e.gate ? <span className="text-emerald-700">On site</span> : <span className="text-slate-400">—</span>}
                </td>
                <td className="px-3 py-2.5">
                  {status ? <span className={cls("inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold", TONE[status].soft)}>{status}</span> : null}
                  {e.mark ? <div className="mt-1 max-w-48 truncate text-xs text-slate-500" title={e.mark.note ?? ""}>✎ {personName(D, e.mark.marked_by)}{e.mark.note ? `: ${e.mark.note}` : ""}</div> : null}
                </td>
                <td className="px-3 py-2.5">
                  {canEdit ? (
                    <div className="flex gap-1" role="group" aria-label={`Mark ${p.full_name}`}>
                      {MARK_STATUSES.map((s) => (
                        <button
                          key={s}
                          disabled={busy}
                          onClick={() => tap(p, e, s)}
                          aria-pressed={status === s}
                          title={e.mark?.status === s ? `Remove the ${s} mark` : s}
                          className={cls("rounded-lg border px-2.5 py-1 text-xs font-semibold transition disabled:opacity-50", status === s ? TONE[s].strong : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}
                        >
                          {SHORT[s]}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <button onClick={() => setOpen({ p })} className="text-xs font-semibold text-brand-700 hover:underline">Details</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 ? <p className="p-6 text-center text-sm text-slate-500">Nobody to show.</p> : null}
      </div>
      {!loaded ? <p className="text-xs text-slate-500">Loading this day's records...</p> : null}
      {canEdit ? <p className="text-xs text-slate-500">Click a status to mark it; click it again to remove the mark. A change against the gate asks for a reason.</p> : null}

      {open ? <MarkModal p={open.p} day={day} entry={dayEntry(ix, open.p, day)} initial={open.status} canEdit={canEdit} me={me} onClose={() => setOpen(null)} onSaved={reload} /> : null}
    </div>
  );
}

// ----------------------------------------------------------- monthly ----

function Monthly({ ix, access, cap, onOpenDay }: { ix: AttendanceIndex; access: AttAccess; cap: number; onOpenDay: (d: string) => void }) {
  const { D, needDays, loadedDays } = useData();
  const today = dayKey();
  const [month, setMonth] = useState(today.slice(0, 7));

  const days = useMemo(() => monthDays(month), [month]);
  const need = Math.min(cap, Math.max(0, Math.ceil((Date.parse(today) - Date.parse(days[0])) / DAY)) + 2);
  useEffect(() => needDays(need), [need, needDays]);
  const ready = loadedDays >= need;
  // Days older than the history this person gets are left blank rather than shown as absent.
  const firstKnown = addDays(today, -(Math.min(loadedDays, cap) - 2));
  const blank: DayEntry = { status: null, source: "auto", noCheckout: false };

  const sheet = useMemo(
    () =>
      attendancePeople(D, ix, days).map((p) => {
        const cells = days.map((d) => (d < firstKnown ? blank : dayEntry(ix, p, d)));
        const n = (s: string) => cells.filter((e) => e.status === s).length;
        return { p, cells, worked: cells.reduce((t, e) => t + dayShare(e.status), 0), absent: n("Absent"), leave: n("Leave"), off: n("Off") };
      }),
    [D, ix, days, firstKnown],
  );
  const total = (k: "worked" | "absent" | "leave") => sheet.reduce((t, r) => t + r[k], 0);

  const download = () => {
    const head = ["Name", "Works as", ...days.map((d) => Number(d.slice(8))), "Days worked", "Absent", "Leave", "Off"];
    const lines = sheet.map((r) => [r.p.full_name, mainRole(D, r.p.id) ?? "", ...r.cells.map((e) => dayCode(D, e)), r.worked, r.absent, r.leave, r.off]);
    const csv = [head, ...lines].map((l) => l.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="month"
          aria-label="Month"
          value={month}
          min={addDays(today, cap === 400 ? -360 : -29).slice(0, 7)}
          max={today.slice(0, 7)}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        />
        <Button kind="soft" disabled={!ready} onClick={download}>Download for Excel</Button>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-3 md:max-w-xl">
        {([["Days worked", "worked"], ["Absent", "absent"], ["Leave", "leave"]] as const).map(([label, k]) => (
          <Card key={k}><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div><div className="text-2xl font-bold">{ready ? total(k) : "–"}</div></Card>
        ))}
      </div>

      <p className="mb-2 text-xs text-slate-500">D day shift · N night shift · P present (marked) · H half day · A absent · L leave · Off weekly off. {access === "edit" ? "Click a day to open it in Daily attendance." : "Click a day to see it."}</p>

      {!ready ? (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">Loading this month...</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full border-collapse text-center text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="sticky left-0 z-10 min-w-44 bg-slate-50 px-3 py-2 text-left font-semibold">Name</th>
                {days.map((d) => (
                  <th key={d} className={cls("min-w-8 px-0.5 py-2 font-semibold", weekdayOf(d) === WEEKLY_OFF && "bg-slate-200", d === today && "text-brand-700 underline")}>{Number(d.slice(8))}</th>
                ))}
                <th className="px-2 py-2 font-semibold">Worked</th>
                <th className="px-2 py-2 font-semibold">Absent</th>
                <th className="px-2 py-2 font-semibold">Leave</th>
                <th className="px-2 py-2 font-semibold">Off</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sheet.map((r) => (
                <tr key={r.p.id}>
                  <td className="sticky left-0 z-10 bg-white px-3 py-1.5 text-left">
                    <div className="text-sm font-semibold text-slate-900">{r.p.full_name}</div>
                    <div className="text-[11px] text-slate-500">{mainRole(D, r.p.id) ?? "No role"}</div>
                  </td>
                  {r.cells.map((e, i) => {
                    const code = dayCode(D, e);
                    return (
                      <td key={days[i]} className="p-0.5">
                        <button
                          disabled={days[i] > today || days[i] < firstKnown}
                          onClick={() => onOpenDay(days[i])}
                          aria-label={`${r.p.full_name}, ${fmtDayKey(days[i])}: ${e.status ?? "nothing recorded"}`}
                          className={cls("h-7 w-full min-w-7 rounded font-semibold hover:ring-1 hover:ring-brand-700 disabled:hover:ring-0", cellTone(e, code), e.source === "mark" && "ring-1 ring-slate-400", e.noCheckout && "underline decoration-dotted")}
                        >
                          {code}
                        </button>
                      </td>
                    );
                  })}
                  <td className="px-2 font-bold">{r.worked}</td>
                  <td className="px-2">{r.absent}</td>
                  <td className="px-2">{r.leave}</td>
                  <td className="px-2">{r.off}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sheet.length === 0 ? <p className="p-6 text-center text-sm text-slate-500">Nobody to show.</p> : null}
        </div>
      )}

      {ready ? <p className="mt-2 text-xs text-slate-500">A boxed day was marked by hand. A dotted underline means there was no check-out at the gate.</p> : null}
    </div>
  );
}

type Choice = AttAccess | "default";

/** The Owner decides who may view or mark the sheet. People left on "Default" get their role's access. */
function AccessModal({ me, onClose, onSaved }: { me: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const { D } = useData();
  const { busy, error, run } = useRun(onSaved);
  const [q, setQ] = useState("");
  const [list, setList] = useState<Record<string, AttAccess>>(() => ({ ...accessList(D) }));
  const people = D.person
    .filter((p) => p.active && !rolesOf(D, p.id).includes("Owner"))
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
    .filter((p) => p.full_name.toLowerCase().includes(q.trim().toLowerCase()));
  const choose = (id: string, c: Choice) =>
    setList((x) => {
      const next = { ...x };
      if (c === "default") delete next[id];
      else next[id] = c;
      return next;
    });
  const saveList = async () => {
    if (await run(() => push([{ table: "setting", data: { key: ATT_ACCESS_KEY, value: list, changed_by: me, changed_at: nowIso() } }], true))) onClose();
  };

  return (
    <Modal title="Attendance access" onClose={onClose} wide>
      <p className="mb-3 text-sm text-slate-500">You (the Owner) can always view and mark. <b>Default</b>: Managers and Supervisors can view and mark, everyone else has no access. Marking also keeps its day limits: a Manager the last 7 days, anyone else today and yesterday.</p>
      <Field label="Search" value={q} onChange={setQ} placeholder="Name" />
      <div className="mt-3 max-h-[55vh] overflow-y-auto rounded-xl border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Roles</th><th className="px-3 py-2">Access</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {people.map((p) => {
              const roles = rolesOf(D, p.id);
              return (
                <tr key={p.id}>
                  <td className="px-3 py-2 font-semibold">{p.full_name}</td>
                  <td className="px-3 py-2 text-slate-500">{roles.join(", ") || "No role"}</td>
                  <td className="px-3 py-2">
                    <select
                      aria-label={`Access for ${p.full_name}`}
                      value={list[p.id] ?? "default"}
                      onChange={(e) => choose(p.id, e.target.value as Choice)}
                      className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
                    >
                      <option value="default">Default: {ACCESS_LABEL[defaultAccess(roles)]}</option>
                      <option value="none">No access</option>
                      <option value="view">View only</option>
                      <option value="edit">View and mark</option>
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {people.length === 0 ? <p className="p-6 text-center text-sm text-slate-500">Nobody to show.</p> : null}
      </div>
      <div className="mt-3"><ErrorText text={error} /></div>
      <div className="mt-4 flex justify-end gap-2">
        <Button kind="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={saveList}>Save</Button>
      </div>
    </Modal>
  );
}

function MarkModal({ p, day, entry: e, initial, canEdit, me, onClose, onSaved }: { p: Row; day: string; entry: DayEntry; initial?: MarkStatus; canEdit: boolean; me: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const { D } = useData();
  const { busy, error, setError, run } = useRun(onSaved);
  const [status, setStatus] = useState<MarkStatus | null>(initial ?? (e.status === "Not marked" ? null : e.status));
  const [note, setNote] = useState<string>(e.mark?.note ?? "");
  const needsReason = !!e.gate && status !== "Present";

  const submit = async () => {
    if (!status) return;
    if (needsReason && !note.trim()) return setError("The gate shows this person came in. Give a reason for changing it.");
    if (await run(() => saveMark(p.id, day, status, note, me))) onClose();
  };
  const reset = async () => { if (await run(() => clearMark(p.id, day))) onClose(); };

  return (
    <Modal title={`${p.full_name} · ${fmtDayKey(day)}`} onClose={onClose}>
      <div className="mb-3 space-y-1 text-sm text-slate-600">
        <p>{e.gate ? `Gate in ${fmtTime(e.gate.gate_in)}${e.lastGate?.gate_out ? `, out ${fmtTime(e.lastGate.gate_out)}` : e.noCheckout ? ", no check-out" : ", on site"}` : "No gate entry."}</p>
        {e.mark ? <p>Marked {e.mark.status} by {personName(D, e.mark.marked_by)}{e.mark.note ? `: ${e.mark.note}` : ""}</p> : null}
      </div>
      {canEdit ? (
        <>
          <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Status">
            {MARK_STATUSES.map((s) => (
              <button key={s} onClick={() => setStatus(s)} aria-pressed={status === s} className={cls("rounded-full border px-4 py-1.5 text-sm font-semibold", status === s ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")}>{s}</button>
            ))}
          </div>
          <Field label={needsReason ? "Reason (required)" : "Note (optional)"} value={note} onChange={(v) => setNote(v.slice(0, 200))} placeholder="Left early, sent home" />
          <div className="mt-3"><ErrorText text={error} /></div>
          <div className="mt-4 flex justify-between gap-2">
            {e.mark ? <Button kind="ghost" disabled={busy} onClick={reset}>Remove mark</Button> : <span />}
            <div className="flex gap-2">
              <Button kind="ghost" onClick={onClose}>Cancel</Button>
              <Button disabled={busy || !status} onClick={submit}>Save</Button>
            </div>
          </div>
        </>
      ) : (
        <>
          <p className="mb-4"><Badge>{e.status ?? "Nothing recorded"}</Badge></p>
          <p className="text-sm text-slate-500">You cannot change this day: it is outside the days you may mark, or you have view-only access.</p>
          <div className="mt-4 flex justify-end"><Button kind="ghost" onClick={onClose}>Close</Button></div>
        </>
      )}
    </Modal>
  );
}
