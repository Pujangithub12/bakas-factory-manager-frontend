import { useEffect, useState } from "react";
import { useData } from "../lib/data";
import { newId, push } from "../lib/api";
import { Button, Card, ErrorText, Field, PageHeader, useRun } from "../components/ui";
import { dedPct, moistStd, priceRaw, priceSale, settingOf, tariffOf, vatRate, wage } from "../shared/money";
import { num } from "../shared/rules";

type Vals = Record<string, string>;
const today = () => new Date().toISOString().slice(0, 10);

/** Rs per kg and the other rates the money pages use. Owner only. A changed price starts today; the old one stays for old trucks. */
export default function Prices() {
  const { D, reload } = useData();
  const { busy, error, run } = useRun(reload);
  const [v, setV] = useState<Vals>({});
  const [saved, setSaved] = useState(false);
  const raws = D.material.filter((m) => m.kind === "Raw");
  const products = D.material.filter((m) => m.kind !== "Raw");
  const T = tariffOf(D);

  // Fill the form once the records have loaded.
  useEffect(() => {
    if (Object.keys(v).length || D.material.length === 0) return;
    const x: Vals = {};
    for (const m of raws) { x[`raw:${m.id}`] = String(priceRaw(D, m.id, null)); x[`std:${m.id}`] = String(moistStd(D, m.id)); }
    for (const b of D.buyer) for (const p of products) { const r = priceSale(D, p.id, b.id); if (D.sale_price.some((s) => s.buyer_id === b.id && s.product_id === p.id)) x[`sale:${b.id}:${p.id}`] = String(r); }
    for (const p of products) x[`vat:${p.id}`] = String(vatRate(D, p.id));
    x.ded = String(dedPct(D)); x.diesel = String(num(settingOf(D, "diesel_rate")));
    x.peak = String(num(T?.peak_rate)); x.off = String(num(T?.offpeak_rate)); x.normal = String(num(T?.normal_rate)); x.demand = String(num(T?.demand_per_kva)); x.kva = String(num(T?.billed_kva));
    for (const r of ["Operator", "Helper", "Driver", "Fitter", "Security", "Supervisor", "Weighbridge", "Store", "Manager"]) x[`wage:${r}`] = String(wage(D, r));
    setV(x);
  }, [D, v]);
  const set = (k: string) => (val: string) => { setSaved(false); setV((x) => ({ ...x, [k]: val.replace(/[^\d.]/g, "") })); };
  const n = (k: string) => Number(v[k]);

  const save = () => run(async () => {
    const ops: { table: string; data: Record<string, unknown> }[] = [];
    const d = today();
    for (const m of raws) {
      if (v[`raw:${m.id}`] !== "" && n(`raw:${m.id}`) !== priceRaw(D, m.id, null)) ops.push({ table: "raw_price", data: { id: newId(), material_id: m.id, supplier_id: null, rate_per_kg: n(`raw:${m.id}`), valid_from: d } });
      if (n(`std:${m.id}`) !== moistStd(D, m.id)) ops.push({ table: "moisture_standard", data: { material_id: m.id, standard_pct: n(`std:${m.id}`) } });
    }
    for (const b of D.buyer) for (const p of products) {
      const k = `sale:${b.id}:${p.id}`;
      if (v[k] !== undefined && v[k] !== "" && n(k) !== priceSale(D, p.id, b.id)) ops.push({ table: "sale_price", data: { id: newId(), buyer_id: b.id, product_id: p.id, rate_per_kg: n(k), valid_from: d } });
    }
    for (const p of products) if (n(`vat:${p.id}`) !== vatRate(D, p.id)) ops.push({ table: "product_vat", data: { product_id: p.id, vat_pct: n(`vat:${p.id}`) } });
    const now = new Date().toISOString();
    if (n("ded") !== dedPct(D)) ops.push({ table: "setting", data: { key: "moisture_deduction", value: n("ded"), changed_at: now } });
    if (n("diesel") !== num(settingOf(D, "diesel_rate"))) ops.push({ table: "setting", data: { key: "diesel_rate", value: n("diesel"), changed_at: now } });
    if (n("peak") !== num(T?.peak_rate) || n("off") !== num(T?.offpeak_rate) || n("normal") !== num(T?.normal_rate) || n("demand") !== num(T?.demand_per_kva) || n("kva") !== num(T?.billed_kva)) {
      ops.push({ table: "nea_tariff", data: { id: newId(), name: T?.name ?? "Industrial, 11 kV, time-of-day meter", demand_per_kva: n("demand"), billed_kva: n("kva"), peak_rate: n("peak"), offpeak_rate: n("off"), normal_rate: n("normal"), valid_from: d } });
    }
    for (const k of Object.keys(v)) if (k.startsWith("wage:") && n(k) !== wage(D, k.slice(5))) ops.push({ table: "daily_wage", data: { role: k.slice(5), rupees: n(k) } });
    if (ops.some((o) => Number.isNaN(Number(o.data.rate_per_kg ?? 0)))) throw new Error("Check the numbers");
    if (ops.length) await push(ops, true);
    setSaved(true);
    setV({});
  });

  const grid = "grid gap-3 md:grid-cols-3 lg:grid-cols-4";
  return (
    <div>
      <PageHeader title="Prices and rates" sub="Rs per kg unless marked. A changed price starts today; trucks weighed earlier keep the price that applied.">
        <Button disabled={busy} onClick={save}>Save prices</Button>
      </PageHeader>
      <ErrorText text={error} />
      {saved ? <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Prices saved.</p> : null}

      <Card>
        <h2 className="mb-2 font-semibold">Raw material we buy (Rs/kg) and moisture standard (%)</h2>
        <div className={grid}>
          {raws.map((m) => (
            <div key={m.id} className="space-y-2">
              <Field label={`${m.name} (Rs/kg)`} value={v[`raw:${m.id}`] ?? ""} onChange={set(`raw:${m.id}`)} />
              <Field label="Standard moisture %" value={v[`std:${m.id}`] ?? ""} onChange={set(`std:${m.id}`)} />
            </div>
          ))}
          <Field label="Deduct % of weight per 1% over" value={v.ded ?? ""} onChange={set("ded")} />
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 mt-4 font-semibold">Sales (Rs/kg before VAT) and VAT %</h2>
        {D.buyer.length === 0 ? <p className="text-sm text-slate-500">Buyers appear here once the weighbridge has added them. Add a price for a buyer by choosing the buyer and product on their first bill.</p> : null}
        <div className={grid}>
          {D.buyer.flatMap((b) => products.map((p) => (
            <Field key={`${b.id}${p.id}`} label={`${b.name} · ${p.name}`} value={v[`sale:${b.id}:${p.id}`] ?? ""} onChange={set(`sale:${b.id}:${p.id}`)} hint={v[`sale:${b.id}:${p.id}`] === undefined ? "no price yet: type one" : undefined} />
          )))}
          {products.map((p) => <Field key={p.id} label={`VAT % ${p.name}`} value={v[`vat:${p.id}`] ?? ""} onChange={set(`vat:${p.id}`)} />)}
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 mt-4 font-semibold">Diesel and electricity</h2>
        <div className={grid}>
          <Field label="Diesel (Rs/L)" value={v.diesel ?? ""} onChange={set("diesel")} />
          <Field label="Peak 17-23 (Rs/kWh)" value={v.peak ?? ""} onChange={set("peak")} />
          <Field label="Off-peak 23-05 (Rs/kWh)" value={v.off ?? ""} onChange={set("off")} />
          <Field label="Normal 05-17 (Rs/kWh)" value={v.normal ?? ""} onChange={set("normal")} />
          <Field label="Demand (Rs/kVA/month)" value={v.demand ?? ""} onChange={set("demand")} />
          <Field label="Billed kVA" value={v.kva ?? ""} onChange={set("kva")} />
        </div>
        <p className="mt-1 text-xs text-slate-500">Confirm the category, voltage and kVA from your NEA bill.</p>
      </Card>

      <Card>
        <h2 className="mb-2 mt-4 font-semibold">Daily wages (Rs per shift)</h2>
        <div className={grid}>
          {Object.keys(v).filter((k) => k.startsWith("wage:")).map((k) => <Field key={k} label={k.slice(5)} value={v[k]} onChange={set(k)} />)}
        </div>
      </Card>
    </div>
  );
}
