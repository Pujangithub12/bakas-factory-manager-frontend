import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../lib/data";
import { Button, Card, PageHeader, Select, Table, Td } from "../components/ui";
import { PaymentModal } from "../components/MoneyForms";
import { DAY, kgFmt } from "../lib/util";
import { avgRate, balances, briquetteId, moneyIn, pelletId, rkg, rsK } from "../shared/money";
import { fiscalYearStart, periodRange } from "../shared/time";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const tons = (t: number) => `${t.toLocaleString("en-US", { maximumFractionDigits: t >= 100 ? 0 : 1 })} t`;

function Tile({ label, value, sub, sub2 }: { label: string; value: string; sub?: string; sub2?: string }) {
  return (
    <Card>
      <div className="text-sm font-semibold text-slate-700">{label}</div>
      <div className="font-display text-3xl font-bold">{value}</div>
      {sub ? <div className="text-sm text-slate-600">{sub}</div> : null}
      {sub2 ? <div className="text-xs text-slate-500">{sub2}</div> : null}
    </Card>
  );
}

/** The Owner's money page: sales, production cost, margin, cost per kg, and who to pay or collect from. */
export default function Money() {
  const { D, reload, needDays } = useData();
  const [period, setPeriod] = useState("30d");
  const [pay, setPay] = useState<"paid" | "received" | null>(null);
  const { from, to } = useMemo(() => (period === "fy" ? { from: fiscalYearStart(), to: new Date() } : periodRange(period as "today" | "yesterday" | "7d" | "30d")), [period]);
  useEffect(() => needDays(Math.ceil((Date.now() - from.getTime()) / DAY) + 2), [from, needDays]);
  const a = from.getTime(), b = to.getTime();
  const m = useMemo(() => moneyIn(D, a, b), [D, a, b]);
  const made = m.pel + m.bri;
  const mg = m.rev > 0 ? m.margin / m.rev : null;
  const pay_ = Object.values(balances(D, "in")).filter((x) => x.n).sort((x, y) => y.bal - x.bal);
  const rec = Object.values(balances(D, "out")).filter((x) => x.n || x.unbilled).sort((x, y) => y.bal - x.bal);
  const rows: [string, number, string][] = [
    ["Raw material used", m.rawUse, `${tons(m.rawUseT)} at ${rkg(m.px)} a kg`],
    ["Electricity", m.elec, `${Math.round(m.kwh).toLocaleString("en-US")} kWh`],
    ["Labour", m.lab, "shifts at the gate x daily wage"],
    ["Diesel", m.dslC, `${Math.round(m.dsl).toLocaleString("en-US")} L`],
    ["Spares and oil", m.spares, "issued from the store"],
  ];

  return (
    <div>
      <PageHeader title="Money" sub="Sales, production cost, margin, what to pay and what to collect. Only the Owner sees rupees anywhere in the system.">
        <Select value={period} onChange={(v) => setPeriod(v || "30d")} placeholder="Period" options={[{ value: "today", label: "Today" }, { value: "yesterday", label: "Yesterday" }, { value: "7d", label: "7 days" }, { value: "30d", label: "30 days" }, { value: "fy", label: "This fiscal year" }]} />
        <Link to="/prices"><Button kind="soft">Prices and rates</Button></Link>
      </PageHeader>

      <div className="grid gap-3 md:grid-cols-4">
        <Tile label="Sales" value={rsK(m.rev)} sub={`${m.sold.length} trucks`} sub2="excluding VAT" />
        <Tile label="Production cost" value={rsK(m.cost)} sub={`${tons(made)} made`} sub2={`raw material ${pct(m.rawUse / (m.cost || 1))} of it`} />
        <Tile label="Margin on sales" value={rsK(m.margin)} sub={mg != null ? `${pct(mg)} of sales` : "nothing sold"} sub2="sales minus the cost of what was sold" />
        <Tile label="Cost per kg of pellet" value={rkg(m.cpel)} sub={`briquette ${rkg(m.cbri)} a kg`} sub2={`selling at ${rkg(avgRate(D, pelletId(D), a, b))} and ${rkg(avgRate(D, briquetteId(D), a, b))}`} />
      </div>

      <h2 className="mb-2 mt-6 font-semibold">Where the money goes</h2>
      <Table head={["Cost", "Amount", "Share", "Basis"]}>
        {rows.map(([l, v, s]) => (
          <tr key={l}><Td>{l}</Td><Td className="font-semibold">{rsK(v)}</Td><Td>{pct(v / (m.cost || 1))}</Td><Td className="text-slate-500">{s}</Td></tr>
        ))}
      </Table>
      <p className="mt-2 text-xs text-slate-500">Raw material used = tons made / yield ({pct(m.yield)}) x the average price paid in the last 30 days. Electricity is shared by the machines that use it; the rest by tons made.
        Raw material bought {rsK(m.rawC)} · {m.raw.length} trucks · {kgFmt(m.ded)} kg not paid for moisture.</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center justify-between"><h2 className="font-semibold">Suppliers to pay</h2><Button small onClick={() => setPay("paid")}>Record payment</Button></div>
          <Table head={["Supplier", "Trucks", "Paid", "Balance"]} empty="No raw material trucks in the records loaded.">
            {pay_.map((x) => <tr key={x.party.id}><Td>{x.party.name}</Td><Td>{x.n}</Td><Td>{rsK(x.paid)}</Td><Td className="font-semibold">{rsK(x.bal)}</Td></tr>)}
          </Table>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between"><h2 className="font-semibold">Buyers to collect from</h2><Button small onClick={() => setPay("received")}>Record receipt</Button></div>
          <Table head={["Buyer", "Bills", "Received", "Balance"]} empty="No sales in the records loaded.">
            {rec.map((x) => (
              <tr key={x.party.id}>
                <Td>{x.party.name}{x.unbilled ? <span className="ml-2 text-xs text-red-700">{x.unbilled} truck{x.unbilled > 1 ? "s" : ""} not billed</span> : null}</Td>
                <Td>{x.n}</Td><Td>{rsK(x.paid)}</Td><Td className="font-semibold">{rsK(x.bal)}</Td>
              </tr>
            ))}
          </Table>
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-500">Balances count the records loaded. Pick a longer period to load more history.</p>
      {pay ? <PaymentModal dir={pay} onClose={() => setPay(null)} onSaved={reload} /> : null}
    </div>
  );
}
