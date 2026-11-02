import { useEffect, useMemo, useState } from "react";
import { useData } from "../lib/data";
import { useAuth } from "../lib/auth";
import { newId, push } from "../lib/api";
import { Button, Card, ErrorText, Field, Modal, PageHeader, Select, Table, Td, useRun } from "../components/ui";
import { DAY, inputToIso, isoToInput } from "../lib/util";
import { BANDS, lastPower, powerIn, rkg, rs, targetsOf, tariffOf, todBand } from "../shared/money";
import { briquetteKg, num, pelletKg } from "../shared/rules";
import { fmtDateTime, periodRange } from "../shared/time";

/** The hourly readings of the main kWh meter, the NEA time-of-day split and the cost (cost for the Owner only). */
export default function Electricity() {
  const { D, reload, needDays } = useData();
  const { session } = useAuth();
  const [period, setPeriod] = useState("7d");
  const [adding, setAdding] = useState(false);
  const owner = session!.roles.includes("Owner");
  const { from, to } = useMemo(() => periodRange(period as "today" | "yesterday" | "7d" | "30d"), [period]);
  useEffect(() => needDays(Math.ceil((Date.now() - from.getTime()) / DAY) + 2), [from, needDays]);
  const a = from.getTime(), b = to.getTime();
  const pw = powerIn(D, a, b);
  const T = tariffOf(D);
  const rates = { peak: num(T?.peak_rate), off: num(T?.offpeak_rate), normal: num(T?.normal_rate) };
  const made = (pelletKg(D, from, to) + briquetteKg(D, from, to, undefined, new Date())) / 1000;
  const perTon = made > 0 ? pw.kwh / made : null;
  const target = targetsOf(D).kwh_per_t;
  const last = lastPower(D);
  const rows = D.power_reading.filter((p) => new Date(p.at).getTime() >= a && new Date(p.at).getTime() < b).sort((x, y) => y.at.localeCompare(x.at)).slice(0, 72);
  const bandRate = (k: string) => (k === "T1" ? rates.peak : k === "T2" ? rates.off : rates.normal);

  return (
    <div>
      <PageHeader title="Electricity" sub="From the hourly readings of the main meter. Bands follow the NEA time-of-day meter.">
        <Select value={period} onChange={(v) => setPeriod(v || "7d")} placeholder="Period" options={[{ value: "today", label: "Today" }, { value: "yesterday", label: "Yesterday" }, { value: "7d", label: "7 days" }, { value: "30d", label: "30 days" }]} />
        <Button onClick={() => setAdding(true)}>Add reading</Button>
      </PageHeader>
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <Card><div className="text-xs text-slate-500">Used</div><div className="font-display text-2xl font-bold">{Math.round(pw.kwh).toLocaleString("en-US")} kWh</div></Card>
        <Card><div className="text-xs text-slate-500">Per ton made</div><div className={`font-display text-2xl font-bold ${perTon && perTon > target * 1.1 ? "text-red-700" : ""}`}>{perTon ? `${Math.round(perTon)} kWh` : "-"}</div><div className="text-xs text-slate-500">target {target} kWh/t (whole plant)</div></Card>
        <Card><div className="text-xs text-slate-500">Last reading</div><div className="font-display text-2xl font-bold">{last ? fmtDateTime(last.at) : "-"}</div><div className="text-xs text-slate-500">{last ? `${num(last.kwh_meter).toLocaleString("en-US")} kWh` : ""}</div></Card>
        {owner ? <Card><div className="text-xs text-slate-500">Cost</div><div className="font-display text-2xl font-bold">{rs(pw.cost)}</div><div className="text-xs text-slate-500">{rs(pw.energy)} energy + {rs(pw.demand)} demand · {pw.kwh ? rkg(pw.cost / pw.kwh) : "-"} per kWh</div></Card> : <Card><div className="text-xs text-slate-500">Tariff</div><div className="font-semibold">{T?.name ?? "-"}</div></Card>}
      </div>
      <h2 className="mb-2 font-semibold">Time of day</h2>
      <Table head={["Band", "kWh", owner ? "Rate" : ""]}>
        {BANDS.map(([k, l]) => <tr key={k}><Td>{l}</Td><Td>{Math.round(pw[k as "T1" | "T2" | "T3"]).toLocaleString("en-US")}</Td><Td>{owner ? `Rs ${bandRate(k)}` : ""}</Td></tr>)}
      </Table>
      <h2 className="mb-2 mt-6 font-semibold">Readings</h2>
      <Table head={["When", "Meter (kWh)", "Load (kW)", "Power factor", "Band", "By"]} empty="No readings in this period.">
        {rows.map((p) => (
          <tr key={p.id}>
            <Td>{fmtDateTime(p.at)}</Td><Td>{num(p.kwh_meter).toLocaleString("en-US")}</Td><Td>{p.load_kw ?? "-"}</Td><Td>{p.power_factor ?? "-"}</Td>
            <Td>{todBand(new Date(p.at).getTime(), rates).b}</Td><Td>{D.person.find((x) => x.id === p.by)?.full_name}</Td>
          </tr>
        ))}
      </Table>
      {adding ? <ReadingModal onClose={() => setAdding(false)} onSaved={reload} /> : null}
    </div>
  );
}

function ReadingModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { D } = useData();
  const { session } = useAuth();
  const last = lastPower(D);
  const [f, setF] = useState({ at: isoToInput(new Date().toISOString()), kwh: "", load: "", pf: "" });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: k === "at" ? v : v.replace(/[^\d.]/g, "") }));
  const { busy, error, run } = useRun(onSaved);
  return (
    <Modal title="Electricity meter reading" onClose={onClose}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Time" type="datetime-local" value={f.at} onChange={set("at")} />
        <Field label="Main meter (kWh)" value={f.kwh} onChange={set("kwh")} hint={last ? `Last ${num(last.kwh_meter).toLocaleString("en-US")} at ${fmtDateTime(last.at)}` : undefined} />
        <Field label="Load now (kW, optional)" value={f.load} onChange={set("load")} />
        <Field label="Power factor (optional)" value={f.pf} onChange={set("pf")} />
      </div>
      <div className="mt-3 space-y-3">
        <ErrorText text={error} />
        <div className="flex justify-end gap-2">
          <Button kind="ghost" onClick={onClose}>Close</Button>
          <Button disabled={busy} onClick={async () => {
            const ok = await run(async () => {
              const at = inputToIso(f.at), k = Number(f.kwh);
              if (!at || new Date(at).getTime() > Date.now() + 5 * 60_000) throw new Error("Enter the time");
              if (!f.kwh || isNaN(k)) throw new Error("Enter the kWh reading");
              if (last && at > last.at && k < num(last.kwh_meter)) throw new Error(`The meter cannot go back: the last reading was ${num(last.kwh_meter)}`);
              if (last && at > last.at && (k - num(last.kwh_meter)) / ((new Date(at).getTime() - new Date(last.at).getTime()) / 3_600_000) > 1500) throw new Error("That is more than the plant can use in that time. Check the reading");
              const pf = f.pf === "" ? null : Number(f.pf);
              if (pf != null && (pf < 0 || pf > 1)) throw new Error("Power factor is between 0 and 1");
              await push([{ table: "power_reading", data: { id: newId(), at, kwh_meter: k, load_kw: f.load === "" ? null : Number(f.load), power_factor: pf, by: session!.person.id } }]);
            });
            if (ok) onClose();
          }}>Save reading</Button>
        </div>
      </div>
    </Modal>
  );
}
