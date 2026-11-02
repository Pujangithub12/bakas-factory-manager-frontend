import { useEffect, useMemo, useState } from "react";
import { useData } from "../lib/data";
import { Card, PageHeader, Select, Table, Td } from "../components/ui";
import { DAY } from "../lib/util";
import { num, personName } from "../shared/rules";
import { fmtDateTime, fmtTime } from "../shared/time";
import { vehStats } from "../shared/vehicles";

const PERIODS = [{ value: "7d", label: "Last 7 days" }, { value: "30d", label: "Last 30 days" }, { value: "all", label: "All records" }];
const ms = (v: any) => new Date(v).getTime();
const f1 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const f0 = (n: number) => Math.round(n).toLocaleString("en-US");
const day = (v: any) => fmtDateTime(v).replace(/ \d\d:\d\d$/, "");

/** Diesel used by the JCB and tractors, from the drivers' entries on their phones. */
export default function Vehicles() {
  const { D, needDays } = useData();
  const [period, setPeriod] = useState("7d");
  const days = period === "30d" ? 30 : period === "all" ? 3650 : 7;
  useEffect(() => needDays(Math.min(400, days + 2)), [days, needDays]);
  const now = Date.now(), a = now - days * DAY;

  const rows = useMemo(() => D.vehicle.map((v) => ({ v, s: vehStats(D, v.id, a, Date.now() + 1) })), [D, a]);
  const types = new Map<string, { n: number; hrs: number; lit: number; used: number; dm: number }>();
  for (const { v, s } of rows) {
    const t = types.get(v.type) ?? { n: 0, hrs: 0, lit: 0, used: 0, dm: 0 };
    t.n++; t.hrs += s.hrs; t.lit += s.lit; t.used += s.used; t.dm += s.dm;
    types.set(v.type, t);
  }
  const fuel = D.diesel_fill.filter((f) => ms(f.at) >= a).sort((x, y) => ms(y.at) - ms(x.at));
  const ses = D.vehicle_session.filter((x) => ms(x.started_at) >= a).sort((x, y) => ms(y.started_at) - ms(x.started_at));
  const vname = (id: string) => D.vehicle.find((v) => v.id === id)?.name ?? "-";
  const R = "text-right";

  return (
    <div>
      <PageHeader title="Vehicles & fuel" sub="Diesel used by the JCB and tractors, from the drivers’ entries on their phones.">
        <Select value={period} onChange={(v) => setPeriod(v || "7d")} options={PERIODS} placeholder="Period" />
      </PageHeader>
      <div className="space-y-4">
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <h2 className="mb-2 font-semibold">By vehicle</h2>
            <Table head={["Vehicle", "Type", "Hours worked", "Diesel (L)", "L per hour", "Last fill"]} empty="No vehicles set up.">
              {rows.map(({ v, s }) => (
                <tr key={v.id}>
                  <Td>{v.name}</Td><Td>{v.type}</Td><Td className={R}>{f1(s.hrs)}</Td><Td className={R}>{f0(s.lit)}</Td>
                  <Td className={R}><b>{s.lph ? f1(s.lph) : "—"}</b></Td>
                  <Td>{s.last ? `${day(s.last.at)} · ${num(s.last.litres)} L` : "—"}</Td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card>
            <h2 className="mb-2 font-semibold">By type</h2>
            <Table head={["Type", "Vehicles", "Hours worked", "Diesel (L)", "L per hour"]} empty="No vehicles set up.">
              {[...types.entries()].map(([k, t]) => (
                <tr key={k}>
                  <Td>{k}</Td><Td className={R}>{t.n}</Td><Td className={R}>{f1(t.hrs)}</Td><Td className={R}>{f0(t.lit)}</Td>
                  <Td className={R}><b>{t.dm > 0 ? f1(t.used / t.dm) : "—"}</b></Td>
                </tr>
              ))}
            </Table>
            <p className="mt-2 text-xs text-slate-500">Litres per hour = diesel filled after the first fill in the period ÷ hour meter between the first and last fill.</p>
          </Card>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <h2 className="mb-2 font-semibold">Diesel fills</h2>
            <Table head={["Date", "Vehicle", "Litres", "Hour meter", "Driver"]} empty="No fills in this period.">
              {fuel.map((f) => (
                <tr key={f.id}>
                  <Td>{fmtDateTime(f.at)}</Td><Td>{vname(f.vehicle_id)}</Td><Td className={R}>{num(f.litres)}</Td>
                  <Td className={R}>{f.meter != null ? f1(num(f.meter)) : "—"}</Td><Td>{personName(D, f.by)}</Td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card>
            <h2 className="mb-2 font-semibold">Work log</h2>
            <Table head={["Date", "Vehicle", "Driver", "Time", "Hours", "Job"]} empty="No work logged in this period.">
              {ses.map((x) => (
                <tr key={x.id}>
                  <Td>{day(x.started_at)}</Td><Td>{vname(x.vehicle_id)}</Td><Td>{personName(D, x.driver_id)}</Td>
                  <Td>{fmtTime(x.started_at)}–{x.stopped_at ? fmtTime(x.stopped_at) : "now"}</Td>
                  <Td className={R}>{x.meter_end != null && x.meter_start != null ? f1(num(x.meter_end) - num(x.meter_start)) : "—"}</Td>
                  <Td>{x.job ?? ""}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      </div>
    </div>
  );
}
