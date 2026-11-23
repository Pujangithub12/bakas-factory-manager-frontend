import { useEffect, useMemo, useState } from "react";
import { useData } from "../lib/data";
import { useAuth } from "../lib/auth";
import { clearMark, saveMark } from "../lib/flows";
import { cls } from "../lib/util";
import { Badge, Button, Card, ErrorText, Field, Modal, PageHeader, useRun } from "../components/ui";
import { MARK_STATUSES, WEEKLY_OFF, attendanceIndex, attendancePeople, canMarkDay, dayCode, dayEntry, dayShare, mainRole, personName, type DayEntry, type MarkStatus } from "../shared/rules";
import { DAY, addDays, dayKey, fmtDayKey, fmtTime, weekdayOf, type Row } from "../shared/time";

const CELL: Record<string, string> = {
  P: "bg-emerald-50 text-emerald-800", H: "bg-amber-50 text-amber-800", A: "bg-red-50 text-red-700",
  L: "bg-blue-50 text-blue-800", Off: "bg-slate-100 text-slate-500",
};
const cellTone = (e: DayEntry, code: string) => (e.status === "Present" ? CELL.P : CELL[code] ?? "");

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

export default function Attendance() {
  const { D, reload, needDays, loadedDays } = useData();
  const { session } = useAuth();
  const me = session!.person.id;
  const roles = session!.roles;
  const today = dayKey();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [open, setOpen] = useState<{ p: Row; day: string } | null>(null);

  const days = useMemo(() => monthDays(month), [month]);
  const need = Math.min(400, Math.max(0, Math.ceil((Date.parse(today) - Date.parse(days[0])) / DAY)) + 2);
  useEffect(() => needDays(need), [need, needDays]);
  const ready = loadedDays >= need;

  const ix = useMemo(() => attendanceIndex(D), [D]);
  const sheet = useMemo(
    () =>
      attendancePeople(D, ix, days).map((p) => {
        const cells = days.map((d) => dayEntry(ix, p, d));
        const n = (s: string) => cells.filter((e) => e.status === s).length;
        return { p, cells, worked: cells.reduce((t, e) => t + dayShare(e.status), 0), absent: n("Absent"), leave: n("Leave"), off: n("Off") };
      }),
    [D, ix, days],
  );
  const todayCount = (s: string) => attendancePeople(D, ix, [today]).filter((p) => dayEntry(ix, p, today).status === s).length;

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
      <PageHeader title="Attendance" sub="Fills itself from the gate. Click a day to mark or correct it.">
        <input
          type="month"
          aria-label="Month"
          value={month}
          min={addDays(today, -360).slice(0, 7)}
          max={today.slice(0, 7)}
          onChange={(e) => e.target.value && setMonth(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        />
        <Button kind="soft" disabled={!ready} onClick={download}>Download for Excel</Button>
      </PageHeader>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[["Present today", "Present"], ["Half day", "Half day"], ["Not in yet", "Not in"], ["On leave", "Leave"], ["Off", "Off"]].map(([label, s]) => (
          <Card key={s}><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div><div className="text-2xl font-bold">{todayCount(s)}</div></Card>
        ))}
      </div>

      <p className="mb-2 text-xs text-slate-500">D day shift · N night shift · P present (marked) · H half day · A absent · L leave · Off weekly off</p>

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
                          disabled={days[i] > today}
                          onClick={() => setOpen({ p: r.p, day: days[i] })}
                          aria-label={`${r.p.full_name}, ${fmtDayKey(days[i])}: ${e.status ?? "nothing recorded"}`}
                          className={cls("h-7 w-full min-w-7 rounded font-semibold hover:ring-1 hover:ring-brand-700 disabled:hover:ring-0", cellTone(e, code), e.source === "mark" && "ring-1 ring-slate-400", e.noCheckout && "underline decoration-dotted")}
                        >
                          {code || (e.status === "Not in" ? "·" : "")}
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

      {open ? <MarkModal p={open.p} day={open.day} entry={dayEntry(ix, open.p, open.day)} canEdit={canMarkDay(roles, open.day, today)} me={me} onClose={() => setOpen(null)} onSaved={reload} /> : null}
    </div>
  );
}

function MarkModal({ p, day, entry: e, canEdit, me, onClose, onSaved }: { p: Row; day: string; entry: DayEntry; canEdit: boolean; me: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const { D } = useData();
  const { busy, error, setError, run } = useRun(onSaved);
  const [status, setStatus] = useState<MarkStatus | null>(e.status === "Not in" ? null : e.status);
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
          <p className="text-sm text-slate-500">This day is outside the days you can change.</p>
          <div className="mt-4 flex justify-end"><Button kind="ghost" onClick={onClose}>Close</Button></div>
        </>
      )}
    </Modal>
  );
}
