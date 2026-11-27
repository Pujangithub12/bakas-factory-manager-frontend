import { useEffect, useMemo, useRef, useState } from "react";
import { useData } from "../lib/data";
import { useAuth } from "../lib/auth";
import { clearMark, saveMark } from "../lib/flows";
import { api, push } from "../lib/api";
import { cls } from "../lib/util";
import { Badge, Button, Card, ErrorText, Field, Modal, PageHeader, useRun } from "../components/ui";
import { ACCESS_LABEL, ATT_ACCESS_KEY, MARK_STATUSES, WEEKLY_OFF, accessList, attendanceAccess, attendanceIndex, attendancePeople, canMarkDay, dayCode, dayEntry, dayShare, defaultAccess, mainRole, personName, rolesOf, type AttAccess, type AttendanceIndex, type DayEntry, type MarkStatus } from "../shared/rules";
import { DAY, addDays, dayKey, fmtDayKey, fmtTime, nowIso, weekdayOf, type Row } from "../shared/time";
import { WEEK_NP, bsKey, dayNum, fmtDay, monthKey, monthLabel, periodDays, useDateMode, type DateMode } from "../lib/nepali";

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

/** < Month > for English or Nepali months. `anchor` is any day in the month shown. */
function MonthNav({ anchor, setAnchor, mode, cap }: { anchor: string; setAnchor: (d: string) => void; mode: DateMode; cap: number }) {
  const today = dayKey();
  const days = periodDays(anchor, mode);
  const earliest = addDays(today, -(cap - 2));
  const next = addDays(days[days.length - 1], 1);
  const btn = "grid h-9 w-9 place-items-center rounded-full text-xl text-brand-700 hover:bg-slate-100 disabled:opacity-30";
  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-1 py-0.5">
      <button aria-label="Previous month" className={btn} disabled={days[0] <= earliest} onClick={() => setAnchor(addDays(days[0], -1))}>‹</button>
      <span className="min-w-36 text-center text-sm font-semibold text-slate-900">{monthLabel(anchor, mode)}</span>
      <button aria-label="Next month" className={btn} disabled={next > today} onClick={() => setAnchor(next)}>›</button>
      {days[days.length - 1] < today ? <button className="px-2 text-xs font-semibold text-brand-700 hover:underline" onClick={() => setAnchor(today)}>This month</button> : null}
    </div>
  );
}

/** A spreadsheet cell: quoted, and a name starting with = + - @ is not run as a formula by Excel. */
const csvCell = (v: string | number) => {
  const s = String(v);
  return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};
/** A mark to save (status) or remove (status null). */
type MarkChange = { person_id: string; day: string; status: MarkStatus | null; note: string | null };

/** Sends marks in one go and puts them on screen at once, without loading everything again. Returns the ones refused. */
async function sendMarks(changes: MarkChange[], me: string, patch: ReturnType<typeof useData>["patch"]) {
  const at = nowIso();
  const done: MarkChange[] = [];
  const failed: { c: MarkChange; error: string }[] = [];
  for (let i = 0; i < changes.length; i += 100) {
    const chunk = changes.slice(i, i + 100);
    const r = await api<{ results: { ok: boolean; error?: string }[] }>("/sync/push", {
      body: {
        ops: chunk.map((c) =>
          c.status
            ? { table: "attendance_mark", op: "upsert", data: { person_id: c.person_id, day: c.day, status: c.status, note: c.note, marked_by: me, marked_at: at } }
            : { table: "attendance_mark", op: "delete", data: { person_id: c.person_id, day: c.day } },
        ),
      },
    });
    chunk.forEach((c, k) => (r.results[k]?.ok ? done.push(c) : failed.push({ c, error: r.results[k]?.error ?? "Refused" })));
  }
  if (done.length) {
    const key = (x: Record<string, unknown>) => `${x.person_id}|${String(x.day).slice(0, 10)}`;
    const gone = new Set(done.map(key));
    patch("attendance_mark", (rows) => [
      ...rows.filter((r) => !gone.has(key(r))),
      ...done.filter((c) => c.status).map((c) => ({ person_id: c.person_id, day: c.day, status: c.status, note: c.note, marked_by: me, marked_at: at })),
    ]);
  }
  return failed;
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

export default function Attendance() {
  const { D } = useData();
  const { session } = useAuth();
  const me = session!.person.id;
  const roles = session!.roles;
  const access = attendanceAccess(D, me, roles);
  const isOwner = roles.includes("Owner");
  // The server sends a year of history to management and a month to anyone else.
  const cap = roles.some((r) => r === "Owner" || r === "Manager" || r === "Supervisor") ? 400 : 31;
  const [tab, setTab] = useState<"daily" | "monthly" | "individual">("daily");
  const [personId, setPersonId] = useState<string | null>(null);
  // Any day in the month shown on the Monthly and Individual tabs.
  const [month, setMonth] = useState(dayKey());
  const [mode, setMode] = useDateMode();
  const [day, setDay] = useState(dayKey());
  const [accessOpen, setAccessOpen] = useState(false);
  // Unsaved marks on the Daily tab.
  const [dirty, setDirty] = useState(0);
  const ix = useMemo(() => attendanceIndex(D), [D]);

  return (
    <div>
      <PageHeader title="Attendance" sub={access === "edit" ? "Fills itself from the gate. Mark or correct a day here." : "Fills itself from the gate. You can view it; the Owner decides who can mark it."}>
        <div role="group" aria-label="Date style" className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 text-sm">
          {(["en", "np"] as const).map((m) => (
            <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)} className={cls("rounded-md px-3 py-1.5 font-semibold", mode === m ? "bg-brand-700 text-white" : "text-slate-600 hover:bg-slate-50")}>
              {m === "en" ? "English date" : "नेपाली मिति"}
            </button>
          ))}
        </div>
        {isOwner ? <Button kind="ghost" onClick={() => setAccessOpen(true)}>Access</Button> : null}
      </PageHeader>

      <div role="tablist" aria-label="Attendance view" className="mb-5 inline-flex rounded-xl bg-slate-100 p-1">
        {(["daily", "monthly", "individual"] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => { if (k !== tab && dirty && !window.confirm(`You have ${dirty} unsaved ${dirty === 1 ? "change" : "changes"}. Leave without saving?`)) return; if (k !== tab) setDirty(0); setTab(k); }}
            className={cls("rounded-lg px-5 py-2 text-sm font-semibold transition", tab === k ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:text-slate-800")}
          >
            {k === "daily" ? "Daily attendance" : k === "monthly" ? "Monthly attendance" : "Individual attendance"}
          </button>
        ))}
      </div>

      {tab === "daily" ? (
        <Daily ix={ix} access={access} cap={cap} day={day} setDay={setDay} mode={mode} onDirty={setDirty} />
      ) : tab === "monthly" ? (
        <Monthly ix={ix} access={access} cap={cap} mode={mode} month={month} setMonth={setMonth} onOpenDay={(d) => { setDay(d); setTab("daily"); }} onOpenPerson={(id) => { setPersonId(id); setTab("individual"); }} />
      ) : (
        <Individual ix={ix} access={access} cap={cap} mode={mode} personId={personId} setPersonId={setPersonId} month={month} setMonth={setMonth} />
      )}

      {accessOpen ? <AccessModal me={me} onClose={() => setAccessOpen(false)} /> : null}
    </div>
  );
}

// ------------------------------------------------------------- daily ----

function Daily({ ix, access, cap, day, setDay, mode, onDirty }: { ix: AttendanceIndex; access: AttAccess; cap: number; day: string; setDay: (d: string) => void; mode: DateMode; onDirty: (n: number) => void }) {
  const { D, needDays, loadedDays, patch } = useData();
  const { session } = useAuth();
  const me = session!.person.id;
  const roles = session!.roles;
  const today = dayKey();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Status | null>(null);
  const [open, setOpen] = useState<Row | null>(null);
  const [ask, setAsk] = useState<{ p: Row; e: DayEntry; status: MarkStatus } | null>(null);
  const { busy, error, setError, run } = useRun();
  const [savedNote, setSavedNote] = useState<string | null>(null);
  // Marks made on screen and not yet saved: person id -> the new status, or null to remove a hand mark.
  const [drafts, setDrafts] = useState<Record<string, { status: MarkStatus | null; note: string | null }>>({});
  const dirty = Object.keys(drafts).length;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (ev: BeforeUnloadEvent) => { ev.preventDefault(); ev.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const go = (d: string) => {
    if (d === day) return;
    if (dirty && !window.confirm(`You have ${dirty} unsaved ${dirty === 1 ? "change" : "changes"}. Leave this day without saving?`)) return;
    setDrafts({});
    setSavedNote(null);
    setError(null);
    setDay(d);
  };

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
        const d = drafts[p.id];
        // With a hand mark removed, the day goes back to the gate, the Saturday Off, or Not marked.
        const status: Status | null = d ? d.status ?? (e.gate ? "Present" : weekdayOf(day) === WEEKLY_OFF ? "Off" : "Not marked") : e.status;
        return { p, e, status, changed: !!d };
      }),
    [D, ix, day, loaded, drafts],
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

  const put = (id: string, v: { status: MarkStatus | null; note: string | null }) => { setSavedNote(null); setDrafts((x) => ({ ...x, [id]: v })); };
  const drop = (id: string) => setDrafts((x) => { const y = { ...x }; delete y[id]; return y; });

  // A click changes the screen only; Save attendance sends it. Clicking the current mark again removes it.
  // A change against the gate asks for a reason first.
  const tap = (p: Row, e: DayEntry, cur: Status | null, s: MarkStatus) => {
    const d = drafts[p.id];
    if (cur === s) {
      if (d) return drop(p.id);
      if (e.mark) return put(p.id, { status: null, note: null });
      return;
    }
    if (e.mark ? e.mark.status === s : e.status === s) return drop(p.id); // back to what is saved
    if (e.gate && s !== "Present") return setAsk({ p, e, status: s });
    put(p.id, { status: s, note: null });
  };

  const save = () =>
    run(async () => {
      const changes = Object.entries(drafts).map(([person_id, d]) => ({ person_id, day, status: d.status, note: d.note }));
      const failed = await sendMarks(changes, me, patch);
      setDrafts(Object.fromEntries(failed.map((f) => [f.c.person_id, drafts[f.c.person_id]])));
      if (failed.length) throw new Error(`${failed.length} not saved (${personName(D, failed[0].c.person_id)}): ${failed[0].error}`);
      setSavedNote(`Saved ${changes.length} ${changes.length === 1 ? "change" : "changes"}.`);
    });

  // "Mark all present" fills in only the people who are Not marked among those shown.
  // Marks already made by hand, gate entries and the Saturday Off are left as they are.
  const unmarked = shown.filter((x) => x.status === "Not marked");
  const markAll = () => {
    setSavedNote(null);
    setDrafts((x) => ({ ...x, ...Object.fromEntries(unmarked.map((u) => [u.p.id, { status: "Present" as MarkStatus, note: null }])) }));
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <Card className="flex flex-col justify-between gap-4">
          <div className="flex items-center gap-2">
            <button aria-label="Previous day" disabled={day <= oldest} onClick={() => go(addDays(day, -1))} className="grid h-10 w-10 place-items-center rounded-full text-2xl text-brand-700 hover:bg-slate-100 disabled:opacity-30">‹</button>
            <div className="flex-1 text-center">
              <div className="text-xs font-semibold uppercase tracking-widest text-slate-500">{(mode === "np" ? WEEK_NP : WEEK)[weekdayOf(day)]} · {label}</div>
              <div className="text-2xl font-bold text-slate-900">{fmtDay(day, mode)}</div>
              {mode === "np" ? <div className="text-xs text-slate-400">{fmtDayKey(day)}</div> : null}
            </div>
            <button aria-label="Next day" disabled={day >= today} onClick={() => go(addDays(day, 1))} className="grid h-10 w-10 place-items-center rounded-full text-2xl text-brand-700 hover:bg-slate-100 disabled:opacity-30">›</button>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              aria-label="Day"
              value={day}
              min={oldest}
              max={today}
              onChange={(e) => e.target.value && e.target.value >= oldest && e.target.value <= today && go(e.target.value)}
              className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            />
            {day !== today ? <Button kind="soft" small onClick={() => go(today)}>Today</Button> : null}
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
          <>
            <Button kind="soft" disabled={busy || !loaded || unmarked.length === 0} onClick={markAll}>
              Mark all present{unmarked.length ? ` (${unmarked.length})` : ""}
            </Button>
            <Button disabled={busy || !dirty} onClick={save}>{busy ? "Saving..." : `Save attendance${dirty ? ` (${dirty})` : ""}`}</Button>
          </>
        ) : null}
      </div>
      <ErrorText text={error} />
      {savedNote && !dirty ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">✓ {savedNote}</p> : null}

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
            {shown.map(({ p, e, status, changed }) => (
              <tr key={p.id} className={changed ? "bg-amber-50/70" : "hover:bg-slate-50/60"}>
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
                  {changed ? <span className="ml-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">Not saved</span> : null}
                  {e.mark && !changed ? <div className="mt-1 max-w-48 truncate text-xs text-slate-500" title={e.mark.note ?? ""}>✎ {personName(D, e.mark.marked_by)}{e.mark.note ? `: ${e.mark.note}` : ""}</div> : null}
                </td>
                <td className="px-3 py-2.5">
                  {canEdit ? (
                    <div className="flex gap-1" role="group" aria-label={`Mark ${p.full_name}`}>
                      {MARK_STATUSES.map((s) => (
                        <button
                          key={s}
                          disabled={busy}
                          onClick={() => tap(p, e, status, s)}
                          aria-pressed={status === s}
                          title={status === s ? "Click again to undo" : s}
                          className={cls("rounded-lg border px-2.5 py-1 text-xs font-semibold transition disabled:opacity-50", status === s ? TONE[s].strong : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}
                        >
                          {SHORT[s]}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <button onClick={() => setOpen(p)} className="text-xs font-semibold text-brand-700 hover:underline">Details</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 ? <p className="p-6 text-center text-sm text-slate-500">Nobody to show.</p> : null}
      </div>
      {!loaded ? <p className="text-xs text-slate-500">Loading this day's records...</p> : null}
      {canEdit ? <p className="text-xs text-slate-500">Click a status to change it, then press Save attendance. Nothing is saved until then. A change against the gate asks for a reason.</p> : null}

      {dirty ? (
        <div className="sticky bottom-3 z-20 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 shadow-lg">
          <span className="text-sm font-semibold text-amber-900">{dirty} unsaved {dirty === 1 ? "change" : "changes"} for {fmtDay(day, mode)}</span>
          <div className="ml-auto flex gap-2">
            <Button kind="ghost" disabled={busy} onClick={() => { setDrafts({}); setError(null); }}>Discard</Button>
            <Button disabled={busy} onClick={save}>{busy ? "Saving..." : "Save attendance"}</Button>
          </div>
        </div>
      ) : null}

      {open ? <MarkModal p={open} day={day} entry={dayEntry(ix, open, day)} canEdit={false} me={me} onClose={() => setOpen(null)} onSaved={async () => {}} /> : null}
      {ask ? (
        <ReasonModal
          p={ask.p}
          day={fmtDay(day, mode)}
          status={ask.status}
          entry={ask.e}
          start={drafts[ask.p.id]?.note ?? ask.e.mark?.note ?? ""}
          onClose={() => setAsk(null)}
          onOk={(note) => { put(ask.p.id, { status: ask.status, note }); setAsk(null); }}
        />
      ) : null}
    </div>
  );
}

// -------------------------------------------------------- individual ----

/** A person dropdown that shows 10 names at a time and scrolls for more, with a search box. */
function PersonPicker({ people, value, onChange, roleOf }: { people: Row[]; value: string | null; onChange: (id: string) => void; roleOf: (id: string) => string | null | undefined }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const current = people.find((x) => x.id === value);
  const needle = q.trim().toLowerCase();
  const shown = people.filter((x) => x.full_name.toLowerCase().includes(needle));

  // Close when clicking anywhere else.
  useEffect(() => {
    if (!open) return;
    const away = (ev: MouseEvent) => { if (box.current && !box.current.contains(ev.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  // Opening starts at the chosen person.
  useEffect(() => {
    if (!open) return;
    setQ("");
    setHi(Math.max(0, people.findIndex((x) => x.id === value)));
  }, [open]);
  useEffect(() => { (listRef.current?.children[hi] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" }); }, [hi, open]);

  const pick = (id: string) => { onChange(id); setOpen(false); };
  const key = (ev: { key: string; preventDefault: () => void }) => {
    if (ev.key === "ArrowDown") { ev.preventDefault(); setHi((h) => Math.min(shown.length - 1, h + 1)); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (ev.key === "Enter") { ev.preventDefault(); if (shown[hi]) pick(shown[hi].id); }
    else if (ev.key === "Escape") setOpen(false);
  };

  return (
    <div ref={box} className="relative min-w-72">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm"
      >
        <span className="truncate">{current ? <><b className="font-semibold">{current.full_name}</b>{roleOf(current.id) ? <span className="text-slate-500"> · {roleOf(current.id)}</span> : null}</> : <span className="text-slate-400">Choose a person</span>}</span>
        <span className="text-slate-400">▾</span>
      </button>
      {open ? (
        <div className="absolute left-0 right-0 z-30 mt-1 rounded-xl border border-slate-200 bg-white shadow-lg">
          <input
            autoFocus
            value={q}
            onChange={(e) => { setQ(e.target.value); setHi(0); }}
            onKeyDown={key}
            placeholder="Search name"
            aria-label="Search name"
            className="w-full rounded-t-xl border-b border-slate-200 px-3 py-2 text-sm outline-none"
          />
          {/* Ten rows of 2.25rem plus the list padding show at once; more scroll. */}
          <ul ref={listRef} role="listbox" className="max-h-[23rem] overflow-y-auto py-1">
            {shown.map((x, i) => (
              <li
                key={x.id}
                role="option"
                aria-selected={x.id === value}
                onMouseEnter={() => setHi(i)}
                onMouseDown={(ev) => { ev.preventDefault(); pick(x.id); }}
                className={cls("flex h-9 cursor-pointer items-center justify-between gap-2 px-3 text-sm", i === hi && "bg-slate-100", x.id === value && "font-semibold text-brand-700")}
              >
                <span className="truncate">{x.full_name}</span>
                <span className="shrink-0 text-xs text-slate-500">{roleOf(x.id) ?? ""}</span>
              </li>
            ))}
            {shown.length === 0 ? <li className="px-3 py-2 text-sm text-slate-500">Nobody matches.</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** One person's whole month as a calendar. Pick days, then mark them all at once. */
function Individual({ ix, access, cap, mode, personId, setPersonId, month, setMonth }: {
  ix: AttendanceIndex; access: AttAccess; cap: number; mode: DateMode;
  personId: string | null; setPersonId: (id: string) => void; month: string; setMonth: (m: string) => void;
}) {
  const { D, needDays, loadedDays, patch } = useData();
  const { session } = useAuth();
  const me = session!.person.id;
  const roles = session!.roles;
  const today = dayKey();
  const { busy, error, setError, run } = useRun();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");

  const days = useMemo(() => periodDays(month, mode), [month, mode]);
  const need = Math.min(cap, Math.max(0, Math.ceil((Date.parse(today) - Date.parse(days[0])) / DAY)) + 2);
  useEffect(() => needDays(need), [need, needDays]);
  const ready = loadedDays >= need;
  const firstKnown = addDays(today, -(Math.min(loadedDays, cap) - 2));

  const people = useMemo(() => attendancePeople(D, ix, days), [D, ix, days]);
  const p = people.find((x) => x.id === personId) ?? null;
  useEffect(() => { if (!p && people.length) setPersonId(people[0].id); }, [p, people, setPersonId]);
  // A new person or month starts with nothing picked.
  useEffect(() => { setPicked(new Set()); setNote(""); setError(null); }, [personId, days[0], setError]);

  const cells = useMemo(
    () => (p ? days.map((d) => ({ d, e: d < firstKnown || d > today ? null : dayEntry(ix, p, d) })) : []),
    [p, days, firstKnown, today, ix],
  );
  const editable = (d: string) => d <= today && d >= firstKnown && canMarkDay(access, roles, d, today);
  const canAny = cells.some((c) => editable(c.d));
  const n = (s: string) => cells.filter((c) => c.e?.status === s).length;
  const worked = cells.reduce((t, c) => t + dayShare(c.e?.status), 0);

  const toggle = (d: string) => setPicked((x) => { const y = new Set(x); if (y.has(d)) y.delete(d); else y.add(d); return y; });
  const pickWhere = (f: (c: { d: string; e: DayEntry | null }) => boolean) => setPicked(new Set(cells.filter((c) => editable(c.d) && f(c)).map((c) => c.d)));
  const chosen = cells.filter((c) => picked.has(c.d) && c.e);

  const apply = (s: MarkStatus) => {
    if (!p || !chosen.length) return;
    // Days the gate already shows as Present need no mark for Present; anything else against the gate needs a reason.
    const todo = chosen.filter((c) => !(s === "Present" && c.e!.source === "gate") && c.e!.mark?.status !== s);
    if (!todo.length) return setPicked(new Set());
    if (s !== "Present" && todo.some((c) => c.e!.gate) && !note.trim()) {
      return setError("The gate shows this person came in on some of these days. Write a reason first.");
    }
    run(async () => {
      const failed = await sendMarks(todo.map((c) => ({ person_id: p.id, day: c.d, status: s, note: note.trim() || null })), me, patch);
      setPicked(new Set(failed.map((f) => f.c.day)));
      if (failed.length) throw new Error(`${failed.length} ${failed.length === 1 ? "day was" : "days were"} not saved: ${failed[0].error}`);
      setNote("");
    });
  };
  const removeMarks = () => {
    if (!p) return;
    const todo = chosen.filter((c) => c.e!.mark);
    if (!todo.length) return setPicked(new Set());
    run(async () => {
      const failed = await sendMarks(todo.map((c) => ({ person_id: p.id, day: c.d, status: null, note: null })), me, patch);
      setPicked(new Set(failed.map((f) => f.c.day)));
      if (failed.length) throw new Error(`${failed.length} ${failed.length === 1 ? "mark was" : "marks were"} not removed: ${failed[0].error}`);
    });
  };

  const lead = weekdayOf(days[0]);
  const slots: (number | null)[] = [...Array(lead).fill(null), ...days.map((_, i) => i)];
  while (slots.length % 7) slots.push(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Person</span>
          <PersonPicker people={people} value={p?.id ?? null} onChange={setPersonId} roleOf={(id) => mainRole(D, id)} />
        </div>
        <div className="text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Month</span>
          <MonthNav anchor={month} setAnchor={setMonth} mode={mode} cap={cap} />
        </div>
      </div>

      {!p ? (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">Nobody to show.</p>
      ) : !ready ? (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">Loading this month...</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-7">
            {([["Days worked", worked, "text-slate-900"], ["Present", n("Present"), "text-emerald-700"], ["Half day", n("Half day"), "text-amber-700"], ["Absent", n("Absent"), "text-red-700"], ["Leave", n("Leave"), "text-blue-700"], ["Off", n("Off"), "text-slate-600"], ["Not marked", n("Not marked"), "text-slate-500"]] as const).map(([label, v, tone]) => (
              <div key={label} className="rounded-2xl border border-slate-200 bg-white p-3 text-center">
                <div className={cls("text-2xl font-bold", tone)}>{v}</div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
              </div>
            ))}
          </div>

          {canAny ? (
            <Card className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold text-slate-700">Select:</span>
                <button onClick={() => pickWhere(() => true)} className="rounded-lg border border-slate-300 bg-white px-3 py-1 font-semibold text-slate-700 hover:bg-slate-50">All days</button>
                <button onClick={() => pickWhere((c) => c.e?.status === "Not marked")} className="rounded-lg border border-slate-300 bg-white px-3 py-1 font-semibold text-slate-700 hover:bg-slate-50">Not marked days</button>
                <button onClick={() => pickWhere((c) => weekdayOf(c.d) !== WEEKLY_OFF)} className="rounded-lg border border-slate-300 bg-white px-3 py-1 font-semibold text-slate-700 hover:bg-slate-50">All but Saturdays</button>
                <button onClick={() => setPicked(new Set())} disabled={!picked.size} className="rounded-lg px-3 py-1 font-semibold text-brand-700 hover:underline disabled:opacity-40">Clear</button>
                <span className="ml-auto text-slate-500">{picked.size} {picked.size === 1 ? "day" : "days"} selected</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-slate-700">Mark selected as:</span>
                {MARK_STATUSES.map((s) => (
                  <button key={s} disabled={busy || !picked.size} onClick={() => apply(s)} className={cls("rounded-lg border px-3 py-1.5 text-sm font-semibold transition disabled:opacity-40", TONE[s].soft, "hover:shadow-sm")}>{s}</button>
                ))}
                <button disabled={busy || !chosen.some((c) => c.e!.mark)} onClick={removeMarks} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 hover:underline disabled:opacity-40">Remove marks</button>
              </div>
              <div className="max-w-md">
                <Field label="Note or reason (needed when the gate shows they came in)" value={note} onChange={(v) => setNote(v.slice(0, 200))} placeholder="On leave for wedding" />
              </div>
              <ErrorText text={error} />
            </Card>
          ) : (
            <p className="text-sm text-slate-500">{access === "edit" ? "You cannot mark any day of this month. A Manager can mark the last 7 days, others today and yesterday." : "You can view this month. Only people the Owner allows can mark it."}</p>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white p-3">
            <div className="mb-2 grid grid-cols-7 gap-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">
              {(mode === "np" ? WEEK_NP : WEEK).map((w, i) => <div key={w} className={cls(i === WEEKLY_OFF && "text-red-600")}>{mode === "np" ? w.replace("बार", "") : w.slice(0, 3)}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-2">
              {slots.map((i, k) => {
                if (i === null) return <div key={k} />;
                const { d, e } = cells[i];
                const st = e?.status ?? null;
                const on = picked.has(d);
                const can = editable(d);
                return (
                  <button
                    key={k}
                    disabled={!can}
                    onClick={() => toggle(d)}
                    aria-pressed={on}
                    aria-label={`${fmtDay(d, mode)}: ${st ?? "nothing recorded"}`}
                    className={cls(
                      "flex min-h-24 flex-col items-stretch rounded-xl border p-2 text-left transition",
                      st ? TONE[st].soft : "border-slate-100 bg-slate-50/50 text-slate-400",
                      can ? "cursor-pointer hover:shadow-sm" : "cursor-default",
                      on && "ring-2 ring-brand-700 ring-offset-1",
                      d === today && "outline outline-2 outline-brand-700/40",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold">{dayNum(d, mode)}{mode === "np" ? <span className="ml-1 text-[10px] font-normal opacity-60">{Number(d.slice(8))}</span> : null}</span>
                      {on ? <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-700 text-[11px] font-bold text-white">✓</span> : e?.source === "mark" ? <span title="Marked by hand" className="text-xs">✎</span> : null}
                    </div>
                    <div className="mt-1 text-xs font-semibold">{st ?? ""}</div>
                    {e?.gate ? <div className="mt-auto text-[11px] opacity-80">{fmtTime(e.gate.gate_in)}{e.lastGate?.gate_out ? `–${fmtTime(e.lastGate.gate_out)}` : e.noCheckout ? " · no out" : ""}</div> : null}
                    {e?.mark?.note ? <div className="truncate text-[11px] opacity-80" title={e.mark.note}>{e.mark.note}</div> : null}
                  </button>
                );
              })}
            </div>
          </div>
          <p className="text-xs text-slate-500">Click days to select them, then choose a status. ✎ means the day was marked by hand; the times are from the gate.</p>
        </>
      )}
    </div>
  );
}

// ----------------------------------------------------------- monthly ----

function Monthly({ ix, access, cap, mode, month, setMonth, onOpenDay, onOpenPerson }: {
  ix: AttendanceIndex; access: AttAccess; cap: number; mode: DateMode; month: string; setMonth: (m: string) => void;
  onOpenDay: (d: string) => void; onOpenPerson: (id: string) => void;
}) {
  const { D, needDays, loadedDays } = useData();
  const today = dayKey();

  const days = useMemo(() => periodDays(month, mode), [month, mode]);
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
    const head = ["Name", "Works as", ...days.map((d) => (mode === "np" ? bsKey(d) : d)), "Days worked", "Absent", "Leave", "Off"];
    const lines = sheet.map((r) => [r.p.full_name, mainRole(D, r.p.id) ?? "", ...r.cells.map((e) => dayCode(D, e)), r.worked, r.absent, r.leave, r.off]);
    const csv = [head, ...lines].map((l) => l.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance-${mode === "np" ? "BS-" : ""}${monthKey(month, mode)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <MonthNav anchor={month} setAnchor={setMonth} mode={mode} cap={cap} />
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
                  <th key={d} className={cls("min-w-8 px-0.5 py-2 font-semibold", weekdayOf(d) === WEEKLY_OFF && "bg-slate-200", d === today && "text-brand-700 underline")}>{dayNum(d, mode)}</th>
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
                    <button onClick={() => onOpenPerson(r.p.id)} title="Open this person's month" className="text-left text-sm font-semibold text-slate-900 hover:text-brand-700 hover:underline">{r.p.full_name}</button>
                    <div className="text-[11px] text-slate-500">{mainRole(D, r.p.id) ?? "No role"}</div>
                  </td>
                  {r.cells.map((e, i) => {
                    const code = dayCode(D, e);
                    return (
                      <td key={days[i]} className="p-0.5">
                        <button
                          disabled={days[i] > today || days[i] < firstKnown}
                          onClick={() => onOpenDay(days[i])}
                          aria-label={`${r.p.full_name}, ${fmtDay(days[i], mode)}: ${e.status ?? "nothing recorded"}`}
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
function AccessModal({ me, onClose }: { me: string; onClose: () => void }) {
  const { D, patch } = useData();
  const { busy, error, run } = useRun();
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
    const row = { key: ATT_ACCESS_KEY, value: list, changed_by: me, changed_at: nowIso() };
    const ok = await run(async () => {
      await push([{ table: "setting", data: row }], true);
      patch("setting", (rows) => [...rows.filter((r) => r.key !== ATT_ACCESS_KEY), row]);
    });
    if (ok) onClose();
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

/** Asks why a person the gate let in is marked otherwise. The answer goes with the mark when it is saved. */
function ReasonModal({ p, day, status, entry: e, start, onClose, onOk }: { p: Row; day: string; status: MarkStatus; entry: DayEntry; start: string; onClose: () => void; onOk: (note: string) => void }) {
  const [note, setNote] = useState(start);
  return (
    <Modal title={`${status}: ${p.full_name}`} onClose={onClose}>
      <p className="mb-3 text-sm text-slate-600">
        {day}. The gate shows {p.full_name} came in at {e.gate ? fmtTime(e.gate.gate_in) : ""}. Why is it being changed?
      </p>
      <Field label="Reason" value={note} onChange={(v) => setNote(v.slice(0, 200))} placeholder="Left early, sent home" />
      <div className="mt-4 flex justify-end gap-2">
        <Button kind="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={!note.trim()} onClick={() => onOk(note.trim())}>OK</Button>
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
