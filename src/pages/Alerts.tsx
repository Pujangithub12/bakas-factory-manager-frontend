import { useMemo, useState } from "react";
import { useData } from "../lib/data";
import { useAuth } from "../lib/auth";
import { Button, Card, Modal, PageHeader } from "../components/ui";
import { cls } from "../lib/util";
import { alertsAll, type AppAlert } from "../shared/rules";

/** What each role sees. Owner, Manager and Supervisor see everything. */
const AREAS: Record<string, string[]> = {
  Operator: ["Machines", "Log sheets", "Electricity"],
  Security: ["Gate", "People"],
  Weighbridge: ["Weighbridge", "Raw material", "Lab"],
  Fitter: ["Machines", "Maintenance plan", "Store"],
  Store: ["Store", "Purchase requests"],
  Driver: [],
};

const TONE_ORDER = { bad: 0, warn: 1, info: 2 } as const;
const rowTone = {
  bad: "border-red-200 bg-red-50 text-red-700",
  warn: "border-amber-200 bg-amber-50 text-amber-800",
  info: "border-blue-200 bg-blue-50 text-blue-800",
};

const Icon = ({ tone }: { tone: AppAlert["tone"] }) =>
  tone === "info" ? (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="12" cy="12" r="8" /></svg>
  ) : (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3 2 20h20L12 3z" /><path d="M12 10v5M12 18v.01" />
    </svg>
  );

/** Everything that needs a look, worked out from the records. Nothing here is typed in. */
export default function Alerts() {
  const { D } = useData();
  const { session } = useAuth();
  const [open, setOpen] = useState<AppAlert | null>(null);
  const roles = session!.roles;

  const list = useMemo(() => {
    const all = alertsAll(D).slice().sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || b.at - a.at);
    if (roles.some((r) => ["Owner", "Manager", "Supervisor"].includes(r))) return all;
    const areas = new Set(roles.flatMap((r) => AREAS[r] ?? []));
    return all.filter((a) => areas.has(a.area));
  }, [D, roles]);

  const by = new Map<string, AppAlert[]>();
  for (const x of list) by.set(x.area, [...(by.get(x.area) ?? []), x]);
  const count = (t: AppAlert["tone"]) => list.filter((x) => x.tone === t).length;

  return (
    <div>
      <PageHeader title="Alerts" sub="Worked out from what people enter. Nothing here is typed by hand. In the real app the red ones also go to phones as a notification." />
      <div className="mb-4 grid max-w-xl grid-cols-3 gap-3">
        <Card className={count("bad") ? "border-red-300 bg-red-50" : ""}><div className={cls("text-2xl font-bold", count("bad") > 0 && "text-red-700")}>{count("bad")}</div><div className="text-xs text-slate-500">Need action now</div></Card>
        <Card><div className="text-2xl font-bold">{count("warn")}</div><div className="text-xs text-slate-500">Warnings</div></Card>
        <Card><div className="text-2xl font-bold">{count("info")}</div><div className="text-xs text-slate-500">For information</div></Card>
      </div>

      {list.length === 0 ? <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">Nothing needs attention.</p> : null}
      <div className="space-y-4">
        {[...by.entries()].map(([area, rows]) => (
          <Card key={area}>
            <h2 className="mb-2 font-semibold">{area}</h2>
            <div className="space-y-2">
              {rows.map((x) => (
                <button key={x.key} type="button" onClick={() => setOpen(x)} className={cls("flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left hover:brightness-95", rowTone[x.tone])}>
                  <span className="mt-0.5 shrink-0"><Icon tone={x.tone} /></span>
                  <span className="min-w-0 flex-1">
                    <b className="block text-slate-900">{x.title}</b>
                    {x.detail ? <small className="block text-slate-600">{x.detail}</small> : null}
                  </span>
                  <span className="shrink-0 text-xs font-semibold">{x.area}</span>
                </button>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {open ? (
        <Modal title={open.title} onClose={() => setOpen(null)}>
          <div className="space-y-3 text-sm">
            <p className="text-slate-700">{open.detail || "No more detail."}</p>
            <p className="text-xs text-slate-500">Area: {open.area}</p>
            <div className="flex justify-end"><Button kind="ghost" onClick={() => setOpen(null)}>Close</Button></div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
