import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useData } from "../lib/data";
import { Badge, Button, Card, PageHeader, Select, Field, Table, Td } from "../components/ui";
import { DAY, dayLabel, dayStartOf, kgFmt, tonFmt } from "../lib/util";
import {
  activeBatch, bagCounts, batchCode, batchMaterial, batchTickets, briquetteKg, machineStatus, mainRole, num, onSiteMap, openRuns, personName, pelletKg,
  sumNet, ticketNet, trucksIn, trucksOut,
} from "../shared/rules";
import { fiscalYearStart, fmtDateTime, fmtTime, periodRange } from "../shared/time";

type PeriodKey = "today" | "yesterday" | "7d" | "30d" | "fy" | "custom";
type Drill = "raw" | "sales" | "pellets" | "briquettes" | "machines" | "people" | "yards";
const COLORS = ["#744820", "#1d4ed8", "#2e7d32", "#c2410c", "#7c3aed", "#0e7490", "#be123c"];

export default function Dashboard() {
  const { D, needDays } = useData();
  const [period, setPeriod] = useState<PeriodKey>("today");
  const [customFrom, setCustomFrom] = useState(dayLabel(new Date(Date.now() - 6 * DAY)));
  const [customTo, setCustomTo] = useState(dayLabel(new Date()));
  const [materialId, setMaterialId] = useState("");
  const [drill, setDrill] = useState<Drill | null>(null);
  const [lineAsTable, setLineAsTable] = useState(false);
  const [pieAsTable, setPieAsTable] = useState(false);

  const now = new Date();
  const { from, to } = useMemo(() => {
    if (period === "fy") return { from: fiscalYearStart(), to: new Date() };
    if (period === "custom") return { from: dayStartOf(customFrom), to: new Date(dayStartOf(customTo).getTime() + DAY) };
    return periodRange(period);
  }, [period, customFrom, customTo]);

  useEffect(() => needDays(Math.ceil((Date.now() - from.getTime()) / DAY) + 2), [from, needDays]);

  const mat = materialId || undefined;
  const pelletMat = D.material.find((m) => m.kind !== "Raw" && m.bag_kg != null);
  const briqMat = D.material.find((m) => /briquette/i.test(m.name) && !/dust/i.test(m.name));
  const showPellets = !mat || mat === pelletMat?.id;
  const showBriq = !mat || mat === briqMat?.id;

  const raw = trucksIn(D, from, to, mat);
  const sales = trucksOut(D, from, to, mat);
  const pellets = showPellets ? pelletKg(D, from, to) : 0;
  const briq = showBriq ? briquetteKg(D, from, to, undefined, now) : 0;
  const site = onSiteMap(D);
  const running = openRuns(D).length;
  const yardsInUse = D.yard.filter((y) => activeBatch(D, y.id)).length;

  const days = useMemo(() => {
    const out: { day: string; raw: number; pellets: number; briquettes: number }[] = [];
    for (let d = dayStartOf(dayLabel(from)); d.getTime() < to.getTime() && out.length < 400; d = new Date(d.getTime() + DAY)) {
      const e = new Date(d.getTime() + DAY);
      out.push({
        day: dayLabel(d).slice(5),
        raw: +(sumNet(trucksIn(D, d, e, mat)) / 1000).toFixed(1),
        pellets: showPellets ? +(pelletKg(D, d, e) / 1000).toFixed(1) : 0,
        briquettes: showBriq ? +(briquetteKg(D, d, e, undefined, now) / 1000).toFixed(1) : 0,
      });
    }
    return out;
  }, [D, from, to, mat, showPellets, showBriq]);

  const byMaterial = D.material
    .filter((m) => m.kind === "Raw")
    .map((m) => ({ name: m.name, kg: sumNet(trucksIn(D, from, to, m.id)), trucks: trucksIn(D, from, to, m.id).length }))
    .filter((x) => x.trucks > 0);
  const total = byMaterial.reduce((n, x) => n + x.kg, 0);

  const Tile = ({ k, label, value, sub }: { k: Drill; label: string; value: string; sub: string }) => (
    <button onClick={() => setDrill(drill === k ? null : k)} className={`rounded-2xl border bg-card p-4 text-left shadow-sm transition hover:border-brand-600 ${drill === k ? "border-brand-700 ring-1 ring-brand-700" : "border-slate-200"}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 font-display text-5xl font-bold leading-none text-slate-900">{value}</div>
      <div className="text-sm text-slate-500">{sub}</div>
    </button>
  );

  const matName = (id: string) => D.material.find((m) => m.id === id)?.name ?? "-";
  const party = (t: any) => (t.direction === "in" ? D.supplier : D.buyer).find((p) => p.id === (t.direction === "in" ? t.supplier_id : t.buyer_id))?.name ?? "-";
  const truckRows = (list: any[]) => list.sort((a, b) => b.second_at.localeCompare(a.second_at)).map((t) => (
    <tr key={t.id}><Td>{fmtDateTime(t.second_at)}</Td><Td>#{t.wbsn}</Td><Td>{t.vehicle_no}</Td><Td>{matName(t.material_id)}</Td><Td>{party(t)}</Td><Td className="text-right font-semibold">{kgFmt(ticketNet(t))} kg</Td></tr>
  ));

  return (
    <div>
      <PageHeader title="Production" sub="Worked out from weights and counts. No rupees. Click a tile for its detail.">
        <Select value={period} onChange={(v) => setPeriod((v || "today") as PeriodKey)} placeholder="Period" options={[
          { value: "today", label: "Today" }, { value: "yesterday", label: "Yesterday" }, { value: "7d", label: "7 days" },
          { value: "30d", label: "30 days" }, { value: "fy", label: "Fiscal year" }, { value: "custom", label: "Pick dates" },
        ]} />
        {period === "custom" ? (
          <>
            <Field label="" type="date" value={customFrom} onChange={setCustomFrom} />
            <Field label="" type="date" value={customTo} onChange={setCustomTo} />
          </>
        ) : null}
        <Select value={materialId} onChange={setMaterialId} placeholder="All materials" options={D.material.map((m) => ({ value: m.id, label: m.name }))} />
      </PageHeader>
      <p className="mb-4 text-xs text-slate-500">{fmtDateTime(from.toISOString())} to {fmtDateTime(to.toISOString())}</p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile k="raw" label="Raw material in" value={`${tonFmt(sumNet(raw))} t`} sub={`${raw.length} trucks`} />
        <Tile k="pellets" label="Pellets made" value={`${tonFmt(pellets)} t`} sub={`${bagCounts(D, from, to).reduce((n, b) => n + num(b.bags), 0)} bags`} />
        <Tile k="briquettes" label="Briquettes made" value={`${tonFmt(briq)} t`} sub="1-minute weight × running time" />
        <Tile k="sales" label="Sales trucks" value={String(sales.length)} sub={`${tonFmt(sumNet(sales))} t`} />
        <Tile k="machines" label="Machines running" value={`${running}/${D.machine.length}`} sub="now" />
        <Tile k="people" label="People on site" value={String(site.size)} sub="now" />
        <Tile k="yards" label="Yards in use" value={`${yardsInUse}/${D.yard.length}`} sub="now" />
      </div>

      {drill ? (
        <div className="mt-4">
          <h2 className="mb-2 font-semibold">{{ raw: "Raw material in", sales: "Sales trucks", pellets: "Pellet bag counts", briquettes: "Briquettes by machine", machines: "Machines now", people: "People on site", yards: "Yards" }[drill]}</h2>
          {drill === "raw" ? <Table head={["Weighed out", "Serial", "Vehicle", "Material", "Supplier", "Net"]}>{truckRows(raw)}</Table> : null}
          {drill === "sales" ? <Table head={["Weighed out", "Serial", "Vehicle", "Product", "Buyer", "Net"]}>{truckRows(sales)}</Table> : null}
          {drill === "pellets" ? (
            <Table head={["Period", "Bags", "kg per bag", "Total", "Counted by"]}>
              {bagCounts(D, from, to).sort((a, b) => b.period_to.localeCompare(a.period_to)).map((b) => (
                <tr key={b.id}><Td>{fmtDateTime(b.period_from)} to {fmtDateTime(b.period_to)}</Td><Td>{b.bags}</Td><Td>{num(b.kg_per_bag)}</Td><Td className="font-semibold">{kgFmt(num(b.bags) * num(b.kg_per_bag))} kg</Td><Td>{personName(D, b.entered_by)}</Td></tr>
              ))}
            </Table>
          ) : null}
          {drill === "briquettes" ? (
            <Table head={["Machine", "Made"]}>
              {D.machine.filter((m) => m.stage === "briquette").map((m) => <tr key={m.id}><Td>{m.tag} {m.name}</Td><Td className="font-semibold">{kgFmt(Math.round(briquetteKg(D, from, to, m.id, now)))} kg</Td></tr>)}
            </Table>
          ) : null}
          {drill === "machines" ? (
            <Table head={["Machine", "State", "Operator", "Since / reason"]}>
              {[...D.machine].sort((a, b) => a.tag.localeCompare(b.tag)).map((m) => {
                const st = machineStatus(D, m);
                return <tr key={m.id}><Td>{m.tag} {m.name}</Td><Td><Badge tone={st.state === "running" ? "good" : st.state === "down" ? "bad" : "mute"}>{st.state}</Badge></Td><Td>{st.operator?.full_name ?? "-"}</Td><Td>{st.run ? fmtTime(st.run.started_at) : st.reason ?? ""}</Td></tr>;
              })}
            </Table>
          ) : null}
          {drill === "people" ? (
            <Table head={["Name", "Role", "Gate in"]} empty="No one is checked in.">
              {[...site.entries()].map(([id, a]) => <tr key={id}><Td>{personName(D, id)}</Td><Td>{mainRole(D, id)}</Td><Td>{fmtTime(a.gate_in)}</Td></tr>)}
            </Table>
          ) : null}
          {drill === "yards" ? (
            <Table head={["Yard", "Batch", "Material", "Trucks", "State"]}>
              {D.yard.map((y) => {
                const b = activeBatch(D, y.id);
                return <tr key={y.id}><Td>{y.name}</Td><Td>{b ? batchCode(D, b) : "-"}</Td><Td>{b ? batchMaterial(D, b)?.name ?? "-" : "-"}</Td><Td>{b ? `${batchTickets(D, b.id).length}/${y.holds_trucks ?? "-"}` : "-"}</Td><Td>{b ? (b.started_at ? "Feeding" : b.closed_at ? "Closed" : "Filling") : "Empty"}</Td></tr>;
              })}
            </Table>
          ) : null}
        </div>
      ) : null}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">Per day (tons)</h2>
            <Button small kind="ghost" onClick={() => setLineAsTable(!lineAsTable)}>{lineAsTable ? "Chart" : "Table"}</Button>
          </div>
          {lineAsTable ? (
            <Table head={["Day", "Raw in", "Pellets", "Briquettes"]}>
              {days.map((d) => <tr key={d.day}><Td>{d.day}</Td><Td>{d.raw}</Td><Td>{d.pellets}</Td><Td>{d.briquettes}</Td></tr>)}
            </Table>
          ) : (
            <div className="h-72">
              <ResponsiveContainer>
                <LineChart data={days}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="day" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="raw" name="Raw in" stroke={COLORS[0]} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="pellets" name="Pellets" stroke={COLORS[1]} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="briquettes" name="Briquettes" stroke={COLORS[2]} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">Raw material by material</h2>
            <Button small kind="ghost" onClick={() => setPieAsTable(!pieAsTable)}>{pieAsTable ? "Chart" : "Table"}</Button>
          </div>
          {byMaterial.length === 0 ? <p className="py-10 text-center text-sm text-slate-500">No finished trucks in this period.</p> : pieAsTable ? (
            <Table head={["Material", "Trucks", "Tons", "Share"]}>
              {byMaterial.map((x) => <tr key={x.name}><Td>{x.name}</Td><Td>{x.trucks}</Td><Td>{tonFmt(x.kg)}</Td><Td>{total ? Math.round((x.kg / total) * 100) : 0}%</Td></tr>)}
            </Table>
          ) : (
            <div className="h-72">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={byMaterial.map((x) => ({ name: x.name, value: +(x.kg / 1000).toFixed(1) }))} dataKey="value" nameKey="name" outerRadius={90} label>
                    {byMaterial.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
