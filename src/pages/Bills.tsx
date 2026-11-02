import { useEffect, useMemo, useState } from "react";
import { useData } from "../lib/data";
import { Badge, Button, PageHeader, Select, Table, Td } from "../components/ui";
import { BillModal } from "../components/MoneyForms";
import { DAY, kgFmt } from "../lib/util";
import { billOf, labOf, rkg, rs, saleAmt, vatOf } from "../shared/money";
import { num, ticketNet } from "../shared/rules";
import { fmtDateTime, periodRange, type Row } from "../shared/time";

/** Every sales truck with its bill: rate, VAT, total, who entered it. Owner only. */
export default function Bills() {
  const { D, reload, needDays } = useData();
  const [period, setPeriod] = useState("30d");
  const [bill, setBill] = useState<Row | null>(null);
  const { from, to } = useMemo(() => periodRange(period as "today" | "yesterday" | "7d" | "30d"), [period]);
  useEffect(() => needDays(Math.ceil((Date.now() - from.getTime()) / DAY) + 2), [from, needDays]);
  const list = D.weigh_ticket.filter((t) => t.direction === "out" && t.second_kg != null && new Date(t.second_at) >= from && new Date(t.second_at) < to).sort((a, b) => b.second_at.localeCompare(a.second_at));
  const unbilled = list.filter((t) => !billOf(D, t.id)).length;
  const name = (id: string | null) => D.person.find((p) => p.id === id)?.full_name ?? "";

  return (
    <div>
      <PageHeader title="Sales bills" sub="Bills and challans are written in the printed books. Here are their numbers, rates and amounts, and who entered them.">
        <Select value={period} onChange={(v) => setPeriod(v || "30d")} placeholder="Period" options={[{ value: "today", label: "Today" }, { value: "yesterday", label: "Yesterday" }, { value: "7d", label: "7 days" }, { value: "30d", label: "30 days" }]} />
      </PageHeader>
      {unbilled ? <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{unbilled} sales truck{unbilled > 1 ? "s" : ""} in this period without a bill entry.</p> : null}
      <Table head={["Out", "Challan", "Bill no.", "Buyer", "Product", "Net (kg)", "Rate", "Amount", "VAT", "Total", "Payment", "Entered by", "Lab", ""]} empty="No sales trucks in this period.">
        {list.map((t) => {
          const B = billOf(D, t.id);
          const lab = labOf(D, t.id);
          return (
            <tr key={t.id}>
              <Td>{fmtDateTime(t.second_at)}</Td><Td>{t.challan_no}</Td>
              <Td>{B ? B.bill_no : <Badge tone="bad">not entered</Badge>}</Td>
              <Td>{D.buyer.find((b) => b.id === t.buyer_id)?.name}</Td><Td>{D.material.find((m) => m.id === t.material_id)?.name}</Td><Td>{kgFmt(ticketNet(t))}</Td>
              {B ? (<><Td>{rkg(num(B.rate))}</Td><Td>{rs(saleAmt(D, t))}</Td><Td>{vatOf(D, t) ? rs(vatOf(D, t)) : "-"}</Td><Td className="font-semibold">{rs(saleAmt(D, t) + vatOf(D, t))}</Td><Td>{B.payment_mode}</Td><Td>{name(B.entered_by)}{B.changed_by ? <span className="text-xs text-slate-500"> (changed by {name(B.changed_by)})</span> : null}</Td></>) : <><Td /><Td /><Td /><Td /><Td /><Td /></>}
              <Td>{lab ? `${num(lab.moisture_pct)}%` : <span className="text-red-700">none</span>}</Td>
              <Td><Button small kind={B ? "ghost" : "primary"} onClick={() => setBill(t)}>{B ? "Change" : "Enter bill"}</Button></Td>
            </tr>
          );
        })}
      </Table>
      {bill ? <BillModal ticket={bill} onClose={() => setBill(null)} onSaved={reload} /> : null}
    </div>
  );
}
