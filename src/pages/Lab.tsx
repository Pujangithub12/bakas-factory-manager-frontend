import { useState } from "react";
import { useData } from "../lib/data";
import { newId, push } from "../lib/api";
import { Badge, Button, ErrorText, Field, Modal, PageHeader, Select, Table, Td, useRun } from "../components/ui";
import { DAY, kgFmt } from "../lib/util";
import { labOf, moistStd, tMoist } from "../shared/money";
import { num, ticketNet } from "../shared/rules";
import { fmtDateTime, productionDayStart, type Row } from "../shared/time";

const METHODS: Record<string, string> = { meter: "Digital moisture meter", oven: "Hot air oven, 105 C", pins: "Moisture pins (quick)" };

/** Moisture (and ash) of a truck. A sales truck gets a printed lab report; on raw material the lab result replaces the pin readings. */
export default function Lab() {
  const { D, reload } = useData();
  const [test, setTest] = useState<Row | null>(null);
  const [report, setReport] = useState<Row | null>(null);
  const t0 = productionDayStart().getTime();
  const party = (t: Row) => (t.direction === "in" ? D.supplier : D.buyer).find((p) => p.id === (t.direction === "in" ? t.supplier_id : t.buyer_id))?.name ?? "";
  const mat = (t: Row) => D.material.find((m) => m.id === t.material_id)?.name ?? "";

  const here = D.weigh_ticket.filter((t) => t.second_kg == null).sort((a, b) => a.first_at.localeCompare(b.first_at));
  const out = D.weigh_ticket.filter((t) => t.direction === "out" && t.second_kg != null && new Date(t.second_at).getTime() >= t0 - 2 * DAY).sort((a, b) => b.second_at.localeCompare(a.second_at));
  const missing = out.filter((t) => !labOf(D, t.id));
  const rawTested = D.weigh_ticket.filter((t) => t.direction === "in" && t.second_kg != null && new Date(t.second_at).getTime() >= t0 - 6 * DAY && labOf(D, t.id)).sort((a, b) => b.second_at.localeCompare(a.second_at));

  const bySupplier = (() => {
    const o: Record<string, { name: string; mat: string; n: number; sum: number; over: number; lab: number; std: number }> = {};
    for (const t of D.weigh_ticket) {
      if (t.direction !== "in" || t.second_kg == null || new Date(t.second_at).getTime() < t0 - 29 * DAY) continue;
      const L = labOf(D, t.id);
      const m = L?.moisture_pct != null ? num(L.moisture_pct) : tMoist(t);
      if (m == null) continue;
      const k = `${t.supplier_id}|${t.material_id}`;
      const x = (o[k] ??= { name: party(t), mat: mat(t), n: 0, sum: 0, over: 0, lab: 0, std: moistStd(D, t.material_id) });
      x.n++; x.sum += m; if (L) x.lab++; if (m > x.std) x.over++;
    }
    return Object.values(o).sort((a, b) => b.sum / b.n - a.sum / a.n);
  })();

  const row = (t: Row) => {
    const L = labOf(D, t.id);
    return (
      <tr key={t.id}>
        <Td>{t.second_at ? fmtDateTime(t.second_at) : <Badge tone="warn">On the scale</Badge>}</Td>
        <Td>{t.direction === "in" ? "In" : <Badge tone="info">Sale</Badge>}</Td><Td>{t.vehicle_no}</Td><Td>{party(t)}</Td><Td>{mat(t)}</Td>
        <Td>{t.direction === "in" && tMoist(t) != null ? `${tMoist(t)!.toFixed(1)}%` : "-"}</Td>
        <Td>{L ? <b>{num(L.moisture_pct).toFixed(1)}%</b> : "-"} {L ? <span className="text-xs text-slate-500">{L.method}</span> : null}</Td>
        <Td><div className="flex gap-2"><Button small kind={L ? "ghost" : "primary"} onClick={() => setTest(t)}>{L ? "Change" : "Test"}</Button>{L && t.direction === "out" ? <Button small kind="ghost" onClick={() => setReport(t)}>Report</Button> : null}</div></Td>
      </tr>
    );
  };
  const head = ["When", "", "Vehicle", "Supplier / buyer", "Material / product", "Pins", "Lab", ""];

  return (
    <div>
      <PageHeader title="Lab" sub="Every sales truck is tested before it leaves and gets a lab report. Raw material is read with the pins on every truck, and tested in the oven when it matters." />
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        {[["On the weighbridge now", here.length], ["Sales trucks, last 3 days", out.length], ["Sales without a lab report", missing.length], ["Raw trucks tested, 7 days", rawTested.length]].map(([l, n]) => (
          <div key={l} className="rounded-xl border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">{l}</div><div className={`font-display text-2xl font-bold ${l === "Sales without a lab report" && n ? "text-red-700" : ""}`}>{n}</div></div>
        ))}
      </div>
      <h2 className="mb-2 font-semibold">On the weighbridge now</h2>
      <Table head={head} empty="No trucks on the weighbridge.">{here.map(row)}</Table>
      <h2 className="mb-2 mt-6 font-semibold">Sales trucks</h2>
      <Table head={head} empty="No sales trucks in the last 3 days.">{out.map(row)}</Table>
      <h2 className="mb-2 mt-6 font-semibold">Raw material tested in the lab (7 days)</h2>
      <Table head={head} empty="No raw material tested in the last 7 days.">{rawTested.map(row)}</Table>
      <h2 className="mb-2 mt-6 font-semibold">Raw material moisture by supplier (30 days)</h2>
      <Table head={["Supplier", "Material", "Trucks", "Lab tested", "Average moisture", "Standard", "Trucks over"]} empty="No readings yet.">
        {bySupplier.map((o) => (
          <tr key={o.name + o.mat}><Td>{o.name}</Td><Td>{o.mat}</Td><Td>{o.n}</Td><Td>{o.lab || "-"}</Td><Td className="font-semibold">{(o.sum / o.n).toFixed(1)}%</Td><Td>{o.std}%</Td><Td>{o.over ? <span className="text-red-700">{o.over}</span> : 0}</Td></tr>
        ))}
      </Table>
      {test ? <LabModal ticket={test} onClose={() => setTest(null)} onSaved={reload} /> : null}
      {report ? <ReportModal ticket={report} onClose={() => setReport(null)} /> : null}
    </div>
  );
}

function LabModal({ ticket, onClose, onSaved }: { ticket: Row; onClose: () => void; onSaved: () => void }) {
  const { D } = useData();
  const L = labOf(D, ticket.id);
  const isIn = ticket.direction === "in";
  const [method, setMethod] = useState<string>(L?.method ?? (isIn ? "oven" : "meter"));
  const s = (v: unknown) => (v == null ? "" : String(num(v)));
  const [f, setF] = useState({ m0: s(L?.reading_1), m1: s(L?.reading_2), m2: s(L?.reading_3), ow: s(L?.oven_wet_g), od: s(L?.oven_dry_g), aw: s(L?.ash_sample_g), aa: s(L?.ash_left_g) });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v.replace(/[^\d.]/g, "") }));
  const { busy, error, run } = useRun(onSaved);

  const calc = () => {
    if (method === "oven") {
      const w = Number(f.ow), d = Number(f.od);
      if (!f.ow || !f.od) throw new Error("Enter the wet and dry weights");
      if (!(w > 0) || d < 0 || d > w) throw new Error("The dry weight must be less than the wet weight");
      return { avg: ((w - d) / w) * 100, r: [null, null, null] as (number | null)[] };
    }
    const r = [f.m0, f.m1, f.m2].map((x) => (x === "" ? null : Number(x)));
    const ok = r.filter((x): x is number => x != null);
    if (!ok.length) throw new Error("Enter at least one moisture reading");
    if (ok.some((x) => x < 0 || x > 70)) throw new Error("Moisture readings are between 0 and 70%");
    return { avg: ok.reduce((n, x) => n + x, 0) / ok.length, r };
  };
  let preview = "";
  try { preview = `Moisture ${calc().avg.toFixed(1)}%`; } catch (e) { preview = (e as Error).message; }

  return (
    <Modal title={`Lab test · ${D.material.find((m) => m.id === ticket.material_id)?.name}`} onClose={onClose}>
      <p className="mb-3 text-sm text-slate-600">{ticket.vehicle_no}{isIn && tMoist(ticket) != null ? ` · pins ${tMoist(ticket)!.toFixed(1)}%` : ""}</p>
      <Select label="Moisture with" value={method} onChange={(v) => setMethod(v || "meter")} options={Object.entries(METHODS).map(([value, label]) => ({ value, label }))} />
      {method === "oven" ? (
        <div className="mt-3 grid gap-3 md:grid-cols-2"><Field label="Wet sample (g)" value={f.ow} onChange={set("ow")} /><Field label="After drying at 105 C (g)" value={f.od} onChange={set("od")} /></div>
      ) : (
        <div className="mt-3 grid gap-3 md:grid-cols-3"><Field label="Reading 1 (%)" value={f.m0} onChange={set("m0")} /><Field label="Reading 2 (%)" value={f.m1} onChange={set("m1")} /><Field label="Reading 3 (%)" value={f.m2} onChange={set("m2")} /></div>
      )}
      <p className="mt-2 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">{preview}</p>
      <h3 className="mb-1 mt-3 text-xs font-semibold uppercase text-slate-500">Ash (optional, muffle furnace)</h3>
      <div className="grid gap-3 md:grid-cols-2"><Field label="Sample (g)" value={f.aw} onChange={set("aw")} /><Field label="Ash left (g)" value={f.aa} onChange={set("aa")} /></div>
      {isIn ? <p className="mt-2 text-xs text-slate-500">The lab result replaces the pin readings when the supplier's moisture deduction is worked out.</p> : null}
      <div className="mt-3 space-y-3">
        <ErrorText text={error} />
        <div className="flex justify-end gap-2">
          <Button kind="ghost" onClick={onClose}>Close</Button>
          <Button disabled={busy} onClick={async () => {
            const ok = await run(async () => {
              const c = calc();
              const aw = f.aw === "" ? null : Number(f.aw), aa = f.aa === "" ? null : Number(f.aa);
              if (aw != null && aa != null && (!(aw > 0) || aa < 0 || aa > aw)) throw new Error("The ash left must be less than the sample");
              const n = D.lab_test.reduce((m, x) => Math.max(m, Number(/(\d+)$/.exec(x.report_no)?.[1] ?? 500)), 500) + 1;
              await push([{ table: "lab_test", data: {
                id: L?.id ?? newId(), report_no: L?.report_no ?? `LR-${String(n).padStart(4, "0")}`, ticket_id: ticket.id, method,
                reading_1: c.r[0], reading_2: c.r[1], reading_3: c.r[2], oven_wet_g: method === "oven" ? Number(f.ow) : null, oven_dry_g: method === "oven" ? Number(f.od) : null,
                moisture_pct: Math.round(c.avg * 10) / 10, ash_sample_g: aw, ash_left_g: aa, ash_pct: aw != null && aa != null ? Math.round((aa / aw) * 1000) / 10 : null,
              } }]);
            });
            if (ok) onClose();
          }}>{L ? "Save" : "Save report"}</Button>
        </div>
      </div>
    </Modal>
  );
}

/** The report that travels with the challan. */
function ReportModal({ ticket, onClose }: { ticket: Row; onClose: () => void }) {
  const { D } = useData();
  const L = labOf(D, ticket.id)!;
  const buyer = D.buyer.find((b) => b.id === ticket.buyer_id);
  const company = String(D.setting.find((s) => s.key === "company_name")?.value ?? "Bakas Renewable Energy Ltd.");
  return (
    <Modal title={`Lab report ${L.report_no}`} onClose={onClose}>
      <div className="space-y-2 text-sm">
        <div className="font-display text-xl font-bold">{company}</div>
        <div className="text-slate-600">LAB TEST REPORT · {L.report_no}</div>
        <div><span className="text-slate-500">Customer</span> <b>{buyer?.name}</b>{buyer?.address ? `, ${buyer.address}` : ""}</div>
        <div><span className="text-slate-500">Product</span> {D.material.find((m) => m.id === ticket.material_id)?.name} · <span className="text-slate-500">Vehicle</span> {ticket.vehicle_no} · <span className="text-slate-500">Challan</span> {ticket.challan_no} · <span className="text-slate-500">Net</span> {kgFmt(ticketNet(ticket))} kg</div>
        <table className="w-full border border-slate-200 text-left">
          <thead className="bg-slate-50"><tr><th className="px-2 py-1">Test</th><th className="px-2 py-1">Result</th><th className="px-2 py-1">Instrument</th></tr></thead>
          <tbody>
            <tr><td className="px-2 py-1">Moisture{L.method === "oven" ? ` (wet ${num(L.oven_wet_g)} g, dry ${num(L.oven_dry_g)} g)` : ""}</td><td className="px-2 py-1 font-bold">{num(L.moisture_pct).toFixed(1)}%</td><td className="px-2 py-1">{METHODS[L.method]}</td></tr>
            {L.ash_pct != null ? <tr><td className="px-2 py-1">Ash</td><td className="px-2 py-1">{num(L.ash_pct)}%</td><td className="px-2 py-1">Muffle furnace</td></tr> : null}
          </tbody>
        </table>
        <div className="grid grid-cols-3 gap-4 pt-8 text-center text-xs text-slate-500"><div className="border-t pt-1">Tested by</div><div className="border-t pt-1">Checked by</div><div className="border-t pt-1">Quality in-charge</div></div>
      </div>
      <div className="mt-3 flex justify-end gap-2"><Button kind="ghost" onClick={onClose}>Close</Button><Button onClick={() => window.print()}>Print</Button></div>
    </Modal>
  );
}

